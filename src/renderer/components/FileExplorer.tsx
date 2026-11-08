import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ContextMenu, type MenuItem } from './ContextMenu'
import type { DirEntry } from '../../main/fileTree'
import { Chevron, FolderIcon, FileIcon } from './FileIcons'

/** Comparable key for a path (separator / trailing-slash insensitive). */
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const relPath = (root: string, p: string) => {
  const r = norm(root), n = norm(p)
  return n.startsWith(r + '/') ? n.slice(r.length + 1) : n
}

type Listing = DirEntry[] | { error: string }
interface Row { entry: DirEntry; depth: number }

// Expanded folders per project root — survives switching projects and hiding the panel.
const expandedByRoot = new Map<string, Set<string>>()

const IconBtn = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
  <button className="fx-btn" title={title} onClick={onClick}>{children}</button>
)

export interface ExplorerProject { id: string; name: string; path: string }

/**
 * Lazy project file tree (VS Code-style). Used twice: on the right of the main window
 * (double-click opens the file in the project's IDE window) and as the project tree of
 * an IDE window. The host decides what opening a file means, and whether paths can be
 * typed into a terminal.
 */
export function FileExplorer({ project, title = 'Explorer', onHide, hideTitle, onOpenFile, insertTarget, reveal }: {
  project: ExplorerProject | undefined
  title?: string
  onHide: () => void
  hideTitle: string
  onOpenFile: (path: string) => void
  /** Main window only: type a path into this terminal (null = no terminal open). */
  insertTarget?: () => { insert: (text: string) => void } | null
  /** IDE window: select this file in the tree, expanding its folders (Alt+F1). */
  reveal?: { path: string; nonce: number } | null
}) {
  const root = project?.path ?? null

  const [tree, setTree] = useState<Record<string, Listing>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const treeRef = useRef(tree); treeRef.current = tree
  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback((dir: string) => {
    window.arw.fs.readDir(dir)
      .then(entries => setTree(t => ({ ...t, [norm(dir)]: entries })))
      .catch(err => setTree(t => ({ ...t, [norm(dir)]: { error: String(err?.message ?? err) } })))
  }, [])

  // New project: reset, restore its expanded folders, load them, and watch for changes.
  useEffect(() => {
    setTree({}); setSelected(null); setMenu(null)
    if (!root) { setExpanded(new Set()); return }
    const exp = expandedByRoot.get(norm(root)) ?? new Set<string>()
    expandedByRoot.set(norm(root), exp)
    setExpanded(new Set(exp))
    load(root)
    exp.forEach(k => load(k))
    window.arw.fs.watch(root)
    const off = window.arw.fs.onChanged(({ root: r, dirs }) => {
      if (norm(r) !== norm(root)) return
      // Only re-list folders we are already showing.
      for (const d of new Set(dirs.map(norm))) if (treeRef.current[d]) load(d)
    })
    return () => { off(); window.arw.fs.unwatch(root) }
  }, [root, load])

  // Select in Project View: expand every folder down to the file, select and scroll to it.
  useEffect(() => {
    if (!reveal || !root) return
    const file = norm(reveal.path), r = norm(root)
    if (!file.toLowerCase().startsWith(r.toLowerCase() + '/')) return
    const parts = file.slice(r.length + 1).split('/')
    const next = new Set(expanded)
    let dir = r
    for (const part of parts.slice(0, -1)) {
      dir = `${dir}/${part}`
      next.add(dir)
      if (!treeRef.current[dir]) load(dir)
    }
    setExp(next)
    setSelected(file)
    let tries = 0
    const t = window.setInterval(() => {
      const el = listRef.current?.querySelector(`[data-path="${CSS.escape(file)}"]`)
      if (el || ++tries > 20) { window.clearInterval(t); el?.scrollIntoView({ block: 'center' }) }
    }, 50)
    return () => window.clearInterval(t)
  }, [reveal?.nonce])

  const setExp = (next: Set<string>) => {
    setExpanded(next)
    if (root) expandedByRoot.set(norm(root), new Set(next))
  }
  const toggleDir = (dir: string) => {
    const k = norm(dir)
    const next = new Set(expanded)
    if (next.has(k)) next.delete(k)
    else { next.add(k); if (!tree[k]) load(dir) }
    setExp(next)
  }
  const refresh = () => {
    if (!root) return
    load(root)
    expanded.forEach(k => load(k))
  }

  // Visible rows: depth-first over expanded, loaded folders.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const walk = (dir: string, depth: number) => {
      const kids = tree[norm(dir)]
      if (!Array.isArray(kids)) return
      for (const entry of kids) {
        out.push({ entry, depth })
        if (entry.isDir && expanded.has(norm(entry.path))) walk(entry.path, depth + 1)
      }
    }
    if (root) walk(root, 0)
    return out
  }, [tree, expanded, root])

  // Double-click / Enter opens the file in the IDE; "Open with Default App" stays in the menu.
  const openFile = onOpenFile
  const openExternal = (p: string) => window.arw.openInExplorer(p)   // OS default app

  const targetTerminal = () => insertTarget?.() ?? null
  const insertIntoTerminal = (p: string) => {
    const t = targetTerminal()
    if (!t || !root) return
    const rel = relPath(root, p)
    t.insert((/\s/.test(rel) ? `"${rel}"` : rel) + ' ')
  }

  const showMenu = (e: React.MouseEvent, entry: DirEntry) => {
    e.preventDefault()
    setSelected(norm(entry.path))
    const items: MenuItem[] = []
    if (!entry.isDir) {
      items.push({ label: 'Open', onClick: () => openFile(entry.path) })
      items.push({ label: 'Open with Default App', onClick: () => openExternal(entry.path) })
    }
    items.push({ label: 'Reveal in File Explorer', onClick: () => window.arw.revealInExplorer(entry.path) })
    if (targetTerminal()) items.push({ label: 'Insert path into terminal', onClick: () => insertIntoTerminal(entry.path) })
    items.push({ label: 'Copy Path', onClick: () => window.arw.clipboardWrite(entry.path) })
    if (root) items.push({ label: 'Copy Relative Path', onClick: () => window.arw.clipboardWrite(relPath(root, entry.path)) })
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // Keyboard navigation (tree semantics, like VS Code).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return
    const i = rows.findIndex(r => norm(r.entry.path) === selected)
    const cur = i >= 0 ? rows[i] : null
    const select = (idx: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, idx))]
      setSelected(norm(r.entry.path))
      listRef.current?.querySelector(`[data-path="${CSS.escape(norm(r.entry.path))}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    switch (e.key) {
      case 'ArrowDown': select(i + 1); break
      case 'ArrowUp': select(i < 0 ? 0 : i - 1); break
      case 'Home': select(0); break
      case 'End': select(rows.length - 1); break
      case 'ArrowRight':
        if (cur?.entry.isDir) {
          if (!expanded.has(norm(cur.entry.path))) toggleDir(cur.entry.path)
          else if (rows[i + 1]?.depth > cur.depth) select(i + 1)
        }
        break
      case 'ArrowLeft':
        if (!cur) break
        if (cur.entry.isDir && expanded.has(norm(cur.entry.path))) toggleDir(cur.entry.path)
        else for (let j = i - 1; j >= 0; j--) if (rows[j].depth < cur.depth) { select(j); break }
        break
      case 'Enter':
        if (cur) cur.entry.isDir ? toggleDir(cur.entry.path) : openFile(cur.entry.path)
        break
      default: return
    }
    e.preventDefault()
  }

  const rootListing = root ? tree[norm(root)] : undefined

  return (
    <div className="fx-root">
      <div className="fx-head">
        <span className="fx-title">{title}</span>
        <div className="fx-actions">
          {root && <>
            <IconBtn title="Refresh Explorer" onClick={refresh}>
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </IconBtn>
            <IconBtn title="Collapse Folders in Explorer" onClick={() => setExp(new Set())}>
              <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M5.5 8h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            </IconBtn>
          </>}
          <IconBtn title={hideTitle} onClick={onHide}>
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </IconBtn>
        </div>
      </div>

      {!project ? (
        <div className="fx-empty">Select a project to see its files.</div>
      ) : (
        <>
          <div className="fx-section" title={project.path}>
            <Chevron open />
            <span className="fx-section-name">{project.name}</span>
          </div>
          <div ref={listRef} className="fx-list scroll-slim" tabIndex={0} onKeyDown={onKeyDown}>
            {rootListing === undefined && <div className="fx-empty">Loading…</div>}
            {rootListing && !Array.isArray(rootListing) && <div className="fx-empty">Can't read this folder.<br /><span className="fx-err">{rootListing.error}</span></div>}
            {Array.isArray(rootListing) && rootListing.length === 0 && <div className="fx-empty">This folder is empty.</div>}
            {rows.map(({ entry, depth }) => {
              const k = norm(entry.path)
              const open = entry.isDir && expanded.has(k)
              return (
                <div key={k} data-path={k}
                  className={`fx-row${selected === k ? ' selected' : ''}`}
                  style={{ paddingLeft: 6 + depth * 12 }}
                  title={entry.path}
                  onClick={() => { setSelected(k); if (entry.isDir) toggleDir(entry.path) }}
                  onDoubleClick={() => { if (!entry.isDir) openFile(entry.path) }}
                  onContextMenu={(e) => showMenu(e, entry)}>
                  {Array.from({ length: depth }, (_, d) => (
                    <span key={d} className="fx-guide" style={{ left: 6 + d * 12 + 7 }} />
                  ))}
                  {entry.isDir ? <Chevron open={open} /> : <span className="fx-chev-space" />}
                  {entry.isDir ? <FolderIcon open={open} /> : <FileIcon name={entry.name} />}
                  <span className="fx-name">{entry.name}</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}
