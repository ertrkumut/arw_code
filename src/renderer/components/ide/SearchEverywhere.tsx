import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { SymRef } from '@shared/csharpAnalysis'
import { fuzzyName } from '@shared/csharp'
import { useNav, type SearchTab } from '../../store/navStore'
import { ideCtx, codeQuery, navigateTo, getEditor } from '../../ide/context'
import { ACTIONS, keysFor, formatKeys } from '../../ide/keymap'
import { runCommand } from '../../ide/commands'
import { fuzzyScore } from '../../ide/fuzzy'
import { baseName } from '../../ide/paths'
import { SymbolIcon } from './SymbolIcon'
import { useIde } from '../../store/ideStore'

const TABS: { id: SearchTab; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'classes', label: 'Classes' }, { id: 'files', label: 'Files' },
  { id: 'symbols', label: 'Symbols' }, { id: 'actions', label: 'Actions' }
]

interface Row { key: string; header?: string; icon?: string; name?: string; label: string; detail?: string; hint?: string; pick?: () => void }

let fileCache: { root: string; files: string[]; at: number } | null = null
async function projectFiles(root: string): Promise<string[]> {
  if (fileCache && fileCache.root === root && Date.now() - fileCache.at < 15000) return fileCache.files
  const files = await window.arw.fs.listFiles(root).catch(() => [] as string[])
  fileCache = { root, files, at: Date.now() }
  return files
}

const join = (root: string, rel: string) => `${root.replace(/[\\/]+$/, '')}/${rel}`.replace(/\//g, root.includes('\\') ? '\\' : '/')

/** "Player.cs:42:7" → name + position */
function splitLine(q: string): { q: string; line?: number; col?: number } {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(q.trim())
  return m ? { q: m[1], line: +m[2], col: m[3] ? +m[3] : undefined } : { q: q.trim() }
}

/** Rider's Search Everywhere (Double Shift) with Classes / Files / Symbols / Actions tabs. */
export function SearchEverywhere({ tab: initialTab, query: initialQuery }: { tab: SearchTab; query?: string }) {
  const [tab, setTab] = useState<SearchTab>(initialTab)
  const [query, setQuery] = useState(initialQuery ?? '')
  const [idx, setIdx] = useState(0)
  const [types, setTypes] = useState<SymRef[]>([])
  const [symbols, setSymbols] = useState<SymRef[]>([])
  const [files, setFiles] = useState<string[] | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const recent = useNav(s => s.recent)
  const index = useNav(s => s.index)
  const close = () => { useNav.getState().close(); getEditor()?.focus() }
  const root = ideCtx.root
  const { q, line, col } = splitLine(query)

  useEffect(() => { void projectFiles(root).then(setFiles) }, [root])

  useEffect(() => {
    let alive = true
    const t = window.setTimeout(() => {
      if (tab === 'all' || tab === 'classes') void codeQuery<SymRef[]>('search', { query: q, scope: 'types', limit: tab === 'all' ? 12 : 200 }).then(r => { if (alive) setTypes(r) }).catch(() => {})
      if (tab === 'all' || tab === 'symbols') {
        if (!q && tab === 'all') setSymbols([])
        else void codeQuery<SymRef[]>('search', { query: q, scope: 'symbols', limit: tab === 'all' ? 12 : 200 }).then(r => { if (alive) setSymbols(r) }).catch(() => {})
      }
    }, 60)
    return () => { alive = false; clearTimeout(t) }
  }, [q, tab])

  const symRow = (s: SymRef): Row => ({
    key: `s:${s.path}:${s.line}:${s.col}`, icon: s.kind, label: s.name,
    detail: [s.container, s.namespace && !s.container?.startsWith(s.namespace) ? s.namespace : ''].filter(Boolean).join(' · ') || undefined,
    hint: `${baseName(s.path)}:${s.line}`,
    pick: () => navigateTo({ path: s.path, line: s.line, col: s.col })
  })

  const fileRows = useMemo((): Row[] => {
    if (!files) return []
    let list: string[]
    if (!q) {
      const rec = recent.map(p => p.replace(/\\/g, '/'))
      const r = root.replace(/\\/g, '/').replace(/\/+$/, '') + '/'
      list = rec.filter(p => p.toLowerCase().startsWith(r.toLowerCase())).map(p => p.slice(r.length))
      if (list.length < 30) list = [...list, ...files.filter(f => !list.includes(f)).slice(0, 30 - list.length)]
    } else {
      list = files.map(f => ({ f, s: fuzzyScore(q, f) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, tab === 'all' ? 10 : 200).map(x => x.f)
    }
    return list.map(f => {
      const name = baseName(f)
      return {
        key: `f:${f}`, icon: 'file', name, label: name, detail: f.slice(0, Math.max(0, f.length - name.length - 1)) || undefined,
        pick: () => {
          const abs = join(root, f)
          if (line) navigateTo({ path: abs, line, col: col ?? 1 })
          else useIde.getState().openFile(ideCtx.projectId, abs)
        }
      }
    })
  }, [files, q, tab, recent, line, col])

  const actionRows = useMemo((): Row[] => {
    const scored = ACTIONS.map(a => ({ a, s: q ? Math.max(fuzzyName(q, a.name), fuzzyName(q, a.id) - 20) : 0 }))
      .filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, tab === 'all' ? 6 : 300)
    return scored.map(({ a }) => ({
      key: `a:${a.id}`, icon: 'action', label: a.name, detail: a.category,
      hint: keysFor(a.id)[0] ? formatKeys(keysFor(a.id)[0]) : undefined,
      pick: () => { getEditor()?.focus(); runCommand(a.command) }
    }))
  }, [q, tab])

  const rows = useMemo((): Row[] => {
    if (tab === 'classes') return types.map(symRow)
    if (tab === 'symbols') return symbols.map(symRow)
    if (tab === 'files') return fileRows
    if (tab === 'actions') return actionRows
    const out: Row[] = []
    const section = (title: string, list: Row[], n: number) => {
      if (!list.length) return
      out.push({ key: `h:${title}`, header: title, label: title })
      out.push(...list.slice(0, n))
    }
    section('Classes', types.map(symRow), 8)
    section('Files', fileRows, 8)
    section('Symbols', symbols.filter(s => !types.some(t => t.path === s.path && t.line === s.line)).map(symRow), 8)
    if (q) section('Actions', actionRows, 5)
    return out
  }, [tab, types, symbols, fileRows, actionRows, q])

  useEffect(() => { setIdx(rows.findIndex(r => !r.header)) }, [rows])
  useEffect(() => { listRef.current?.children[idx]?.scrollIntoView({ block: 'nearest' }) }, [idx])

  const move = (d: number) => {
    if (!rows.length) return
    let i = idx
    for (let n = 0; n < rows.length; n++) { i = (i + d + rows.length) % rows.length; if (!rows[i].header) break }
    setIdx(i)
  }
  const pick = (i: number) => { const r = rows[i]; if (!r || r.header) return; close(); r.pick?.() }
  const cycleTab = (d: number) => {
    const i = TABS.findIndex(t => t.id === tab)
    setTab(TABS[(i + d + TABS.length) % TABS.length].id)
  }

  const indexing = index && index.state !== 'ready'
  const noCode = (tab === 'classes' || tab === 'symbols') && index?.state === 'ready' && index.files === 0

  return (
    <div className="modal-overlay goto-overlay" onMouseDown={close}>
      <div className="se-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="se-tabs">
          {TABS.map(t => <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
          <span className="se-tip">Tab to switch · <kbd>{formatKeys(keysFor('SearchEverywhere')[0] ?? 'DOUBLE_SHIFT')}</kbd></span>
        </div>
        <input autoFocus className="goto-input" value={query}
          placeholder={tab === 'actions' ? 'Type an action name' : tab === 'files' ? 'Type a file name (Name.cs:42 jumps to a line)' : tab === 'classes' ? 'Type a class name (CamelHumps: PlCo → PlayerController)' : 'Type a name'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); close() }
            else if (e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1) }
            else if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
            else if (e.key === 'Enter') { e.preventDefault(); pick(idx) }
          }} />
        <div className="goto-list scroll-slim" ref={listRef}>
          {indexing && (tab !== 'files' && tab !== 'actions') && <div className="se-note">Indexing C# files… {index!.done}/{index!.total}</div>}
          {noCode && <div className="se-note">No C# files in this project.</div>}
          {rows.length === 0 && !indexing && !noCode && <div className="goto-empty">{files === null && tab === 'files' ? 'Listing files…' : 'Nothing found'}</div>}
          {rows.map((r, i) => r.header
            ? <div key={r.key} className="pl-header">{r.header}</div>
            : (
              <div key={r.key} className={`goto-row${i === idx ? ' active' : ''}`} onMouseMove={() => setIdx(i)} onClick={() => pick(i)}>
                <SymbolIcon kind={r.icon} name={r.name} />
                <span className="goto-name">{r.label}</span>
                {r.detail && <span className="goto-dir">{r.detail}</span>}
                {r.hint && <span className="se-hint">{r.hint}</span>}
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
