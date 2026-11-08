import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNav, type FindItem } from '../../store/navStore'
import { ideCtx, navigateTo } from '../../ide/context'
import { applyEdits } from '../../ide/commands'
import { openEntries, getEntry } from '../../ide/models'
import { baseName, fileKey, relativeTo } from '../../ide/paths'
import { FileIcon } from '../FileIcons'
import { Marked } from './ListPopup'
import { ConfirmDialog } from '../ConfirmDialog'
import { shortcutLabel } from '../../ide/keymap'

/**
 * The Find tool window (Alt+3): Find Usages results, and Find / Replace in Files
 * (Ctrl+Shift+F / Ctrl+Shift+R) with case / whole-word / regex / file-mask options.
 */
export function FindPanel({ onHide, tabs }: { onHide: () => void; tabs?: React.ReactNode }) {
  const find = useNav(s => s.find)!
  const [sel, setSel] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const q = find.query

  // ---- run Find in Files as the query changes ----
  useEffect(() => {
    if (find.mode !== 'text' || !q) return
    if (!q.text) { useNav.getState().setFind({ items: [], busy: false, error: undefined, truncated: false }); return }
    let alive = true
    const t = window.setTimeout(async () => {
      useNav.getState().setFind({ busy: true })
      const overlays: Record<string, string> = {}
      for (const e of openEntries()) {
        const entry = getEntry(e.path)
        if (entry && entry.model.getAlternativeVersionId() !== entry.savedVersion) overlays[e.path] = e.model.getValue()
      }
      try {
        const r = await window.arw.code.findInFiles(ideCtx.root, { query: q.text, regex: q.regex, matchCase: q.matchCase, wholeWord: q.wholeWord, mask: q.mask, overlays })
        if (alive) useNav.getState().setFind({ items: r.matches, busy: false, error: r.error, truncated: r.truncated })
      } catch (err: any) {
        if (alive) useNav.getState().setFind({ busy: false, error: String(err?.message ?? err) })
      }
    }, 220)
    return () => { alive = false; clearTimeout(t) }
  }, [find.mode, q?.text, q?.regex, q?.matchCase, q?.wholeWord, q?.mask])

  useEffect(() => { if (find.mode === 'text') inputRef.current?.focus() }, [find.title])
  useEffect(() => { setSel(0); setCollapsed(new Set()) }, [find.items])

  const groups = useMemo(() => {
    const m = new Map<string, FindItem[]>()
    for (const it of find.items) { const k = fileKey(it.path); const a = m.get(k) ?? []; a.push(it); m.set(k, a) }
    return [...m.values()]
  }, [find.items])

  // flat rows for keyboard navigation
  const rows = useMemo(() => {
    const out: ({ kind: 'file'; path: string; count: number } | { kind: 'hit'; item: FindItem })[] = []
    for (const g of groups) {
      out.push({ kind: 'file', path: g[0].path, count: g.length })
      if (!collapsed.has(fileKey(g[0].path))) g.forEach(item => out.push({ kind: 'hit', item }))
    }
    return out
  }, [groups, collapsed])

  useEffect(() => { listRef.current?.querySelector('.fp-row.sel')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const setQ = (patch: Partial<NonNullable<typeof q>>) => useNav.getState().setFind({ query: { ...q!, ...patch } })
  const open = (it: FindItem) => navigateTo({ path: it.path, line: it.line, col: it.col })
  const toggleGroup = (path: string) => setCollapsed(s => { const n = new Set(s); const k = fileKey(path); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(rows.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const r = rows[sel]
      if (!r) return
      if (r.kind === 'hit') open(r.item); else toggleGroup(r.path)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const r = rows[sel]
      if (r?.kind === 'file') { e.preventDefault(); toggleGroup(r.path) }
    }
  }

  const replaceAll = async () => {
    if (!q) return
    const flags = q.matchCase ? '' : 'i'
    let src = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (q.wholeWord) src = `(?<![A-Za-z0-9_])(?:${src})(?![A-Za-z0-9_])`
    const re = new RegExp(src, flags)
    const edits: { path: string; line: number; col: number; len: number; text: string }[] = []
    for (const g of groups) {
      const path = g[0].path
      const model = getEntry(path)?.model
      let lines: string[]
      if (model) lines = model.getLinesContent()
      else {
        const f = await window.arw.fs.readFile(path)
        if (f.kind !== 'text') continue
        lines = f.content.split('\n')
      }
      for (const it of g) {
        const line = (lines[it.line - 1] ?? '').replace(/\r$/, '')
        const hit = line.substr(it.col - 1, it.len)
        edits.push({ path, line: it.line, col: it.col, len: it.len, text: q.regex ? hit.replace(re, q.replace ?? '') : (q.replace ?? '') })
      }
    }
    const n = await applyEdits(edits)
    useNav.getState().setFind({ title: `Replaced ${n} occurrence${n === 1 ? '' : 's'} — Find in Files`, items: [] })
  }

  const total = find.items.length
  const fileCount = groups.length
  return (
    <div className="fp-root">
      <div className="dbg-head fp-head">
        {tabs}
        <span className="fp-title">{find.title}</span>
        {find.mode === 'text' && <span className="fp-count">{find.busy ? 'Searching…' : find.error ? '' : `${total}${find.truncated ? '+' : ''} match${total === 1 ? '' : 'es'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`}</span>}
        {find.mode === 'usages' && <span className="fp-count">{total} usage{total === 1 ? '' : 's'} in {fileCount} file{fileCount === 1 ? '' : 's'}</span>}
        <div style={{ flex: 1 }} />
        <button className="dbg-btn" title={`Hide (${shortcutLabel('ActivateFindToolWindow') || 'Alt+3'})`} onClick={onHide}>
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {find.mode === 'text' && q && (
        <div className="fp-query">
          <div className="fp-qrow">
            <input ref={inputRef} className="fp-input" placeholder="Find in files" value={q.text} onChange={(e) => setQ({ text: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && rows.length) { e.preventDefault(); const h = rows.find(r => r.kind === 'hit'); if (h && h.kind === 'hit') open(h.item) } if (e.key === 'ArrowDown') { e.preventDefault(); listRef.current?.focus() } }} />
            <button className={`fp-opt${q.matchCase ? ' on' : ''}`} title="Match case" onClick={() => setQ({ matchCase: !q.matchCase })}>Cc</button>
            <button className={`fp-opt${q.wholeWord ? ' on' : ''}`} title="Words" onClick={() => setQ({ wholeWord: !q.wholeWord })}>W</button>
            <button className={`fp-opt${q.regex ? ' on' : ''}`} title="Regex" onClick={() => setQ({ regex: !q.regex })}>.*</button>
            <input className="fp-mask" placeholder="File mask: *.cs, *.shader" value={q.mask} onChange={(e) => setQ({ mask: e.target.value })} />
            <button className={`fp-opt${find.showReplace ? ' on' : ''}`} title="Replace" onClick={() => useNav.getState().setFind({ showReplace: !find.showReplace })}>⇄</button>
          </div>
          {find.showReplace && (
            <div className="fp-qrow">
              <input className="fp-input" placeholder={q.regex ? 'Replace with ($1 for groups)' : 'Replace with'} value={q.replace ?? ''} onChange={(e) => setQ({ replace: e.target.value })} />
              <button className="btn-soft fp-replace" disabled={!total || find.busy} onClick={() => setConfirm(true)}>Replace All</button>
            </div>
          )}
          {find.error && <div className="fp-error">{find.error}</div>}
        </div>
      )}
      <div className="fp-list scroll-slim" ref={listRef} tabIndex={0} onKeyDown={onListKey}>
        {total === 0 && !find.busy && <div className="fp-empty">{find.mode === 'usages' ? 'No usages found.' : q?.text ? 'No matches.' : 'Type to search the project.'}</div>}
        {rows.map((r, i) => r.kind === 'file'
          ? (
            <div key={`f${r.path}`} className={`fp-row fp-file${i === sel ? ' sel' : ''}`} onClick={() => { setSel(i); toggleGroup(r.path) }}>
              <span className="fp-chev">{collapsed.has(fileKey(r.path)) ? '▸' : '▾'}</span>
              <FileIcon name={baseName(r.path)} />
              <span className="fp-fname">{baseName(r.path)}</span>
              <span className="fp-fdir">{relativeTo(ideCtx.root, r.path).slice(0, -baseName(r.path).length - 1)}</span>
              <span className="fp-fcount">{r.count}</span>
            </div>
          )
          : (
            <div key={`h${r.item.path}:${r.item.line}:${r.item.col}`} className={`fp-row fp-hit${i === sel ? ' sel' : ''}`}
              onClick={() => { setSel(i); open(r.item) }}>
              <span className="fp-line">{r.item.line}</span>
              <span className="fp-text"><Marked text={r.item.text} mark={r.item.preview} /></span>
            </div>
          ))}
      </div>
      {confirm && q && (
        <ConfirmDialog title="Replace in Files"
          message={<>Replace <b>{total}</b> occurrence{total === 1 ? '' : 's'} of <b>{q.text}</b> in <b>{fileCount}</b> file{fileCount === 1 ? '' : 's'} with <b>{q.replace || '(empty)'}</b>?<br />Open files are changed in the editor (unsaved); others are written to disk.</>}
          confirmLabel="Replace" danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => { setConfirm(false); void replaceAll() }} />
      )}
    </div>
  )
}
