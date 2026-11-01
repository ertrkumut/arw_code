import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FileIcon } from '../FileIcons'
import { baseName } from '../../ide/paths'
import { fuzzyScore } from '../../ide/fuzzy'

/** Rider-style "Go to File" (Ctrl+Shift+N) / "Go to Class" (Ctrl+P → .cs files only). */
export function GotoFile({ root, mode, onPick, onClose }: {
  root: string
  mode: 'file' | 'class'
  onPick: (absPath: string) => void
  onClose: () => void
}) {
  const [files, setFiles] = useState<string[] | null>(null)
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    window.arw.fs.listFiles(root).then(f => { if (alive) setFiles(f) }).catch(() => { if (alive) setFiles([]) })
    return () => { alive = false }
  }, [root])

  const results = useMemo(() => {
    const pool = (files ?? []).filter(f => mode === 'file' || f.toLowerCase().endsWith('.cs'))
    if (!query) return pool.slice(0, 200)
    return pool.map(f => ({ f, s: fuzzyScore(query, f) })).filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s).slice(0, 200).map(x => x.f)
  }, [files, query, mode])

  useEffect(() => { setIdx(0) }, [query, mode])
  useEffect(() => { listRef.current?.children[idx]?.scrollIntoView({ block: 'nearest' }) }, [idx])

  const pick = (rel: string | undefined) => {
    if (!rel) return
    onPick(`${root.replace(/[\\/]+$/, '')}/${rel}`.replace(/\//g, root.includes('\\') ? '\\' : '/'))
  }

  return (
    <div className="modal-overlay goto-overlay" onMouseDown={onClose}>
      <div className="goto-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="goto-head">{mode === 'class' ? 'Classes (.cs files)' : 'Files'}</div>
        <input autoFocus className="goto-input" placeholder={mode === 'class' ? 'Type a class / script name' : 'Type a file name'}
          value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(results.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); pick(results[idx]) }
          }} />
        <div className="goto-list scroll-slim" ref={listRef}>
          {files === null && <div className="goto-empty">Indexing project…</div>}
          {files !== null && results.length === 0 && <div className="goto-empty">No matches</div>}
          {results.map((rel, i) => {
            const name = baseName(rel)
            const dir = rel.slice(0, rel.length - name.length).replace(/\/$/, '')
            return (
              <div key={rel} className={`goto-row${i === idx ? ' active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => pick(rel)}>
                <FileIcon name={name} />
                <span className="goto-name">{mode === 'class' ? name.replace(/\.cs$/i, '') : name}</span>
                <span className="goto-dir">{dir}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
