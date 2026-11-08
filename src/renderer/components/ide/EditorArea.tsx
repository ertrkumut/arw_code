import React, { useEffect, useRef } from 'react'
import { useIde } from '../../store/ideStore'
import { CodeEditor } from './CodeEditor'
import { FileIcon } from '../FileIcons'
import { baseName, fileKey, relativeTo } from '../../ide/paths'
import { releaseModel, saveFile, openPathsIn, reloadIfClean } from '../../ide/models'
import { ConfirmDialog } from '../ConfirmDialog'
import { useEdits } from '../../store/editsStore'
import { useNav } from '../../store/navStore'
import { SymbolIcon } from './SymbolIcon'
import { navigateTo } from '../../ide/context'

const EMPTY = { paths: [] as string[], active: null as string | null }

/** Editor tabs + the code editor for the selected project. */
export function EditorArea({ project }: { project: { id: string; path: string } }) {
  const tabs = useIde(s => (project ? s.tabs[project.id] : undefined) ?? EMPTY)
  const files = useIde(s => s.files)
  const edits = useEdits(s => s.edits)
  const closeRequest = useIde(s => s.closeRequest)
  const crumbSymbols = useNav(s => s.caret?.symbols)
  const notice = useIde(s => s.notice)
  const { setActiveTab, requestCloseTab, closeTab, cancelClose } = useIde.getState()
  const stripRef = useRef<HTMLDivElement>(null)

  // Reload clean buffers when their files change on disk (e.g. Claude edited them).
  const root = project?.path
  const hasTabs = tabs.paths.length > 0
  useEffect(() => {
    if (!root || !hasTabs) return
    window.arw.fs.watch(root)
    const off = window.arw.fs.onChanged(({ root: r, dirs }) => {
      if (fileKey(r) !== fileKey(root)) return
      const st = useIde.getState()
      const imageTabs = (st.tabs[project.id]?.paths ?? []).filter(p => st.files[fileKey(p)]?.kind === 'image')
      openPathsIn(dirs, imageTabs).forEach(p => void reloadIfClean(p))
    })
    return () => { off(); window.arw.fs.unwatch(root) }
  }, [root, hasTabs])

  // Keep the active tab scrolled into view.
  useEffect(() => {
    stripRef.current?.querySelector('.ed-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tabs.active])

  const close = (path: string) => {
    requestCloseTab(project.id, path)
  }
  // Model cleanup once a tab is really gone.
  const prevPaths = useRef<string[]>([])
  useEffect(() => {
    const now = new Set(tabs.paths.map(p => fileKey(p)))
    const gone = prevPaths.current.filter(p => !now.has(fileKey(p)))
    gone.forEach(releaseModel)
    gone.forEach(p => useNav.getState().noteClosed(p))
    prevPaths.current = tabs.paths
  }, [tabs.paths])

  const active = tabs.active
  const dupNames = new Set(tabs.paths.map(baseName).filter((n, i, a) => a.indexOf(n) !== i))

  return (
    <div className="ed-area">
      <div className="ed-tabs scroll-none" ref={stripRef} onWheel={(e) => { stripRef.current!.scrollLeft += e.deltaY }}>
        {tabs.paths.map(p => {
          const k = fileKey(p)
          const st = files[k]
          const dirty = st?.kind === 'ready' && st.dirty
          const name = baseName(p)
          const rel = relativeTo(project.path, p)
          const isActive = active != null && fileKey(active) === k
          const ai = !!edits[k]
          return (
            <div key={k} className={`ed-tab${isActive ? ' active' : ''}${dirty ? ' dirty' : ''}${ai ? ' ai' : ''}`} title={ai ? `${rel}\nChanged by Claude — not reviewed yet` : rel}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); close(p) } }}
              onClick={() => setActiveTab(project.id, p)}>
              <FileIcon name={name} />
              <span className="ed-tab-name">{name}</span>
              {dupNames.has(name) && <span className="ed-tab-dir">{rel.split('/').slice(-2, -1)[0]}</span>}
              <span className="ed-tab-close" title="Close (Ctrl+W)" onClick={(e) => { e.stopPropagation(); close(p) }}>
                <span className="ed-dirty-dot" />
                <svg width="16" height="16" viewBox="0 0 16 16"><path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
              </span>
            </div>
          )
        })}
      </div>
      {active && (
        <div className="ed-crumbs">
          {relativeTo(project.path, active).split('/').map((seg, i, a) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="ed-crumb-sep">›</span>}
              <span className={i === a.length - 1 ? 'ed-crumb last' : 'ed-crumb'}>{seg}</span>
            </React.Fragment>
          ))}
          {crumbSymbols?.filter(c => c.kind !== 'namespace').map((c, i) => (
            <React.Fragment key={`s${i}`}>
              <span className="ed-crumb-sep">›</span>
              <span className="ed-crumb sym" title={`Go to ${c.name}`} onClick={() => navigateTo({ path: active, line: c.line, col: c.col })}>
                <SymbolIcon kind={c.kind} />{c.name}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
      {notice && (
        <div className="ed-notice" onClick={() => useIde.setState({ notice: null })}>{notice} <span style={{ opacity: .6 }}>✕</span></div>
      )}
      <CodeEditor path={active} />
      {closeRequest && closeRequest.projectId === project.id && (
        <ConfirmDialog
          title="Save changes?"
          message={<><b>{baseName(closeRequest.path)}</b> has unsaved changes.</>}
          confirmLabel="Save"
          cancelLabel="Cancel"
          extraLabel="Don't save"
          onExtra={() => closeTab(closeRequest.projectId, closeRequest.path)}
          onConfirm={async () => { if (await saveFile(closeRequest.path)) closeTab(closeRequest.projectId, closeRequest.path) }}
          onCancel={cancelClose}
        />
      )}
    </div>
  )
}
