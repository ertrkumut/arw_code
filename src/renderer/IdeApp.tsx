import React, { useEffect, useRef, useState } from 'react'
import { useIde } from './store/ideStore'
import { useDebug } from './store/debugStore'
import { FileExplorer } from './components/FileExplorer'
import { EditorArea } from './components/ide/EditorArea'
import { DebugPanel } from './components/ide/DebugPanel'
import { RunWidget, ThemePicker, useIsUnityProject } from './components/ide/RunWidget'
import { ConfirmDialog } from './components/ConfirmDialog'
import { createWindowKeyHandler, shortcutLabel } from './ide/keymap'
import { dirtyPaths, saveAll } from './ide/models'
import { ideCtx, goBack, goForward } from './ide/context'
import { runCommand } from './ide/commands'
import { useNav } from './store/navStore'
import { FindPanel } from './components/ide/FindPanel'
import { StatusBar } from './components/ide/StatusBar'
import { Popups } from './components/ide/Popups'
import logo from './assets/arw-logo.svg'
import { ClaudeChanges } from './components/ide/ClaudeChanges'
import { useEdits } from './store/editsStore'

interface Props { projectId: string; name: string; path: string }

const NO_TABS: string[] = []

/** Drag helper for the two splitters. */
function useDrag(onMove: (ev: PointerEvent) => void, onDone: () => void) {
  const [active, setActive] = useState(false)
  const start = (e: React.PointerEvent) => {
    e.preventDefault()
    setActive(true)
    const up = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', up)
      setActive(false)
      onDone()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
  }
  return { active, start }
}

/**
 * A project's IDE window (one per project, like a Rider solution window):
 * project tree | editor tabs, with the Debug tool window underneath while debugging.
 */
export function IdeApp({ projectId, name, path }: Props) {
  const project = { id: projectId, name, path }
  const treeOpen = useIde(s => s.treeOpen)
  const treeWidth = useIde(s => s.treeWidth)
  const bottomHeight = useIde(s => s.bottomHeight)
  const debugOpen = useIde(s => s.debugOpen)
  const hasTabs = useIde(s => (s.tabs[projectId]?.paths ?? NO_TABS).length > 0)
  const debugPhase = useDebug(s => s.phase)
  const debugError = useDebug(s => !!s.error)
  const isUnity = useIsUnityProject(path)
  const [closePrompt, setClosePrompt] = useState<string[] | null>(null)
  const popupOpen = useNav(s => !!s.popup)
  const findOpen = useNav(s => s.findOpen && !!s.find)
  const bottomTab = useNav(s => s.bottomTab)
  const activeTab = useIde(s => s.tabs[projectId]?.active ?? null)
  const selectInTree = useNav(s => s.selectInTree)
  const allowClose = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const colRef = useRef<HTMLDivElement>(null)

  const showDebug = debugOpen && (debugPhase !== 'idle' || debugError)
  const showBottom = showDebug || findOpen
  const bottom2 = showDebug && findOpen
  const activeBottom: 'find' | 'debug' = !showDebug ? 'find' : !findOpen ? 'debug' : bottomTab

  // Code-insight context for this window (commands, the C# index, buffer sync).
  ideCtx.projectId = projectId
  ideCtx.root = path
  ideCtx.isUnity = isUnity

  // Recent Files / Switcher
  useEffect(() => { if (activeTab) useNav.getState().touchRecent(activeTab) }, [activeTab])

  useEffect(() => { document.title = `${name} — ARWCode IDE` }, [name])

  // Claude's edits to review, and "open at line" requests from the chat.
  useEffect(() => {
    useEdits.getState().load()
    const show = (r: { file: string; line: number } | null) => { if (r) useIde.getState().openFile(projectId, r.file, r.line) }
    void window.arw.ide.takeReveal(projectId).then(show)
    const off = window.arw.ide.onReveal(show)
    return () => { off() }
  }, [projectId])

  // ---- keymap: window-level actions (work wherever focus is in this window) ----
  const blocked = useRef(false)
  blocked.current = popupOpen || !!closePrompt
  useEffect(() => {
    const { keydown, keyup } = createWindowKeyHandler(runCommand, () => blocked.current || !!useIde.getState().closeRequest)
    // Mouse back / forward buttons navigate like Rider.
    const mouse = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); goBack() }
      else if (e.button === 4) { e.preventDefault(); goForward() }
    }
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('mouseup', mouse)
    return () => {
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('keyup', keyup, true)
      window.removeEventListener('mouseup', mouse)
    }
  }, [])

  // ---- unsaved changes guard when the window closes ----
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowClose.current) return
      const dirty = dirtyPaths()
      if (!dirty.length) return
      e.preventDefault()
      e.returnValue = false
      setClosePrompt(dirty)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
  const closeWindow = () => { allowClose.current = true; window.close() }

  // ---- splitters ----
  const tree = useDrag(
    (ev) => { const r = bodyRef.current!.getBoundingClientRect(); useIde.getState().setTreeWidth(ev.clientX - r.left, false) },
    () => useIde.getState().setTreeWidth(useIde.getState().treeWidth))
  const bottom = useDrag(
    (ev) => { const r = colRef.current!.getBoundingClientRect(); useIde.getState().setBottomHeight(Math.min(r.bottom - ev.clientY, r.height - 120), false) },
    () => useIde.getState().setBottomHeight(useIde.getState().bottomHeight))

  return (
    <div className="ide-root">
      <div className="titlebar ide-titlebar">
        <img src={logo} width={22} height={22} alt="" draggable={false} />
        <span className="ide-proj" title={path}>{name}</span>
        <button className={`tb-btn nodrag${treeOpen ? ' active' : ''}`} title="Project (Alt+1)" onClick={() => useIde.getState().toggleTree()}>
          <svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.2" />{treeOpen && <rect x="1.5" y="2.5" width="4.5" height="11" rx="1" fill="currentColor" opacity=".35" />}</svg>
        </button>
        <div style={{ flex: 1 }} />
        <button className="tb-btn nodrag" title={`Search Everywhere (${shortcutLabel('SearchEverywhere')})`} onClick={() => runCommand('arw.searchEverywhere')}>
          <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
        <ClaudeChanges projectId={projectId} root={path} />
        <RunWidget project={project} />
        <ThemePicker />
        <button className="tb-btn nodrag" title={`Settings (${shortcutLabel('ShowSettings')})`} onClick={() => runCommand('arw.settings')}>
          <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
        <div style={{ width: 140 }} />{/* native window controls */}
      </div>

      <div className="ide-body" ref={bodyRef}>
        {treeOpen && (
          <>
            <div className="ide-tree" style={{ width: treeWidth }}>
              <FileExplorer project={project} title="Project" hideTitle="Hide Project (Alt+1)"
                onHide={() => useIde.getState().toggleTree()}
                onOpenFile={(file) => useIde.getState().openFile(projectId, file)} reveal={selectInTree} />
            </div>
            <div className={`sidebar-resizer${tree.active ? ' active' : ''}`} onPointerDown={tree.start}
              onDoubleClick={() => useIde.getState().setTreeWidth(280)} role="separator" aria-orientation="vertical" />
          </>
        )}
        <div className="ide-main" ref={colRef}>
          <div className="ide-editor">
            {hasTabs ? <EditorArea project={project} /> : (
              <div className="ide-welcome">
                <img src={logo} width={72} height={72} alt="" draggable={false} style={{ opacity: .9 }} />
                <div className="ide-welcome-keys">
                  <span>Search Everywhere</span><kbd>{shortcutLabel('SearchEverywhere')}</kbd>
                  <span>Go to File</span><kbd>{shortcutLabel('GotoFile')}</kbd>
                  <span>Go to Class</span><kbd>{shortcutLabel('GotoClass')}</kbd>
                  <span>Find in Files</span><kbd>{shortcutLabel('FindInPath')}</kbd>
                  <span>Recent Files</span><kbd>{shortcutLabel('RecentFiles')}</kbd>
                  <span>Project tree</span><kbd>{shortcutLabel('ActivateProjectToolWindow')}</kbd>
                  <span>Settings &amp; Keymap</span><kbd>{shortcutLabel('ShowSettings')}</kbd>
                  {isUnity && <><span>Attach to Unity</span><kbd>{shortcutLabel('Debug')}</kbd></>}
                </div>
              </div>
            )}
          </div>
          {showBottom && (
            <>
              <div className={`h-resizer${bottom.active ? ' active' : ''}`} onPointerDown={bottom.start}
                onDoubleClick={() => useIde.getState().setBottomHeight(280)} role="separator" aria-orientation="horizontal" />
              <div className="ide-bottom" style={{ height: bottomHeight }}>
                {bottom2 && (
                  <div className="tw-tabs">
                    <button className={activeBottom === 'find' ? 'active' : ''} onClick={() => useNav.setState({ bottomTab: 'find' })}>Find</button>
                    <button className={activeBottom === 'debug' ? 'active' : ''} onClick={() => useNav.setState({ bottomTab: 'debug' })}>Debug</button>
                  </div>
                )}
                <div className={`tw-body${bottom2 ? ' tabbed' : ''}`}>
                  {activeBottom === 'find'
                    ? <FindPanel onHide={() => useNav.getState().setFindOpen(false)} />
                    : <DebugPanel onHide={() => useIde.getState().setDebugOpen(false)} />}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <StatusBar />
      <Popups />
      {closePrompt && (
        <ConfirmDialog
          title="Save changes before closing?"
          message={<>{closePrompt.length === 1 ? 'One file has' : `${closePrompt.length} files have`} unsaved changes.</>}
          confirmLabel="Save all"
          extraLabel="Don't save"
          onExtra={closeWindow}
          onConfirm={async () => { if (await saveAll()) closeWindow() }}
          onCancel={() => setClosePrompt(null)}
        />
      )}
    </div>
  )
}
