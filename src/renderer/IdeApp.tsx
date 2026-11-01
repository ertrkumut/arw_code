import React, { useEffect, useRef, useState } from 'react'
import { useIde } from './store/ideStore'
import { useDebug } from './store/debugStore'
import { FileExplorer } from './components/FileExplorer'
import { EditorArea } from './components/ide/EditorArea'
import { DebugPanel } from './components/ide/DebugPanel'
import { RunWidget, ThemePicker, useIsUnityProject } from './components/ide/RunWidget'
import { GotoFile } from './components/ide/GotoFile'
import { ConfirmDialog } from './components/ConfirmDialog'
import { RIDER_KEYMAP, WINDOW_COMMANDS, matchesKey } from './ide/keymap'
import { dirtyPaths, saveAll } from './ide/models'
import logo from './assets/arw-logo.svg'

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
  const [goto, setGoto] = useState<'file' | 'class' | null>(null)
  const [closePrompt, setClosePrompt] = useState<string[] | null>(null)
  const allowClose = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const colRef = useRef<HTMLDivElement>(null)

  const showDebug = debugOpen && (debugPhase !== 'idle' || debugError)

  useEffect(() => { document.title = `${name} — ARWCode IDE` }, [name])

  // ---- Rider keymap: window-level commands (work wherever focus is in this window) ----
  useEffect(() => {
    const run = (command: string) => {
      const ide = useIde.getState(), dbg = useDebug.getState()
      const tabs = ide.tabs[projectId]
      switch (command) {
        case 'arw.closeTab': if (tabs?.active) ide.requestCloseTab(projectId, tabs.active); return true
        case 'arw.saveAll': void saveAll(); return true
        case 'arw.gotoFile': setGoto('file'); return true
        case 'arw.gotoClass': setGoto('class'); return true
        case 'arw.toggleTree': ide.toggleTree(); return true
        case 'arw.toggleDebug': ide.setDebugOpen(!ide.debugOpen); return true
        case 'arw.hideAll': {
          const anyOpen = ide.treeOpen || ide.debugOpen
          if (ide.treeOpen === anyOpen) ide.toggleTree()
          ide.setDebugOpen(!anyOpen)
          return true
        }
        case 'arw.debug':
          if (!isUnity || dbg.phase !== 'idle') return false
          ide.setDebugOpen(true); void dbg.attach(projectId, path); return true
      }
      if (dbg.phase === 'idle') return false          // step keys do nothing until attached
      switch (command) {
        case 'arw.resume': dbg.resume(); return true
        case 'arw.stepOver': dbg.stepOver(); return true
        case 'arw.stepInto': dbg.stepInto(); return true
        case 'arw.stepOut': dbg.stepOut(); return true
        case 'arw.stop': dbg.stop(); return true
      }
      return false
    }
    const bindings = RIDER_KEYMAP.filter(b => WINDOW_COMMANDS.has(b.command))
    const onKey = (e: KeyboardEvent) => {
      if (goto || closePrompt || useIde.getState().closeRequest) return   // a dialog owns the keyboard
      const b = bindings.find(x => x.keys.some(k => matchesKey(e, k)))
      if (b && run(b.command)) { e.preventDefault(); e.stopImmediatePropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [projectId, path, isUnity, goto, closePrompt])

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
        <RunWidget project={project} />
        <ThemePicker />
        <div style={{ width: 140 }} />{/* native window controls */}
      </div>

      <div className="ide-body" ref={bodyRef}>
        {treeOpen && (
          <>
            <div className="ide-tree" style={{ width: treeWidth }}>
              <FileExplorer project={project} title="Project" hideTitle="Hide Project (Alt+1)"
                onHide={() => useIde.getState().toggleTree()}
                onOpenFile={(file) => useIde.getState().openFile(projectId, file)} />
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
                  <span>Go to File</span><kbd>Ctrl+Shift+N</kbd>
                  <span>Go to Class</span><kbd>Ctrl+P</kbd>
                  <span>Project tree</span><kbd>Alt+1</kbd>
                  {isUnity && <><span>Attach to Unity</span><kbd>Shift+F9</kbd></>}
                </div>
              </div>
            )}
          </div>
          {showDebug && (
            <>
              <div className={`h-resizer${bottom.active ? ' active' : ''}`} onPointerDown={bottom.start}
                onDoubleClick={() => useIde.getState().setBottomHeight(280)} role="separator" aria-orientation="horizontal" />
              <div className="ide-bottom" style={{ height: bottomHeight }}>
                <DebugPanel onHide={() => useIde.getState().setDebugOpen(false)} />
              </div>
            </>
          )}
        </div>
      </div>

      {goto && (
        <GotoFile root={path} mode={goto} onClose={() => setGoto(null)}
          onPick={(file) => { setGoto(null); useIde.getState().openFile(projectId, file) }} />
      )}
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
