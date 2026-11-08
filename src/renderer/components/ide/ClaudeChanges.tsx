import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useEdits } from '../../store/editsStore'
import { useIde } from '../../store/ideStore'
import { FileIcon } from '../FileIcons'
import { baseName, fileKey, relativeTo } from '../../ide/paths'
import { getEntry } from '../../ide/models'
import { diffLines, diffStat, splitLines, type AgentEdit } from '@shared/agentEdits'

interface Row { edit: AgentEdit; add: number; del: number; first: number }

/** Every file Claude changed in this project and hasn't been reviewed yet. */
async function rowsFor(edits: AgentEdit[]): Promise<Row[]> {
  return Promise.all(edits.map(async (edit) => {
    let current: string[] | null = getEntry(edit.path)?.model.getLinesContent() ?? null
    if (!current) {
      try { const f = await window.arw.fs.readFile(edit.path); if (f.kind === 'text') current = splitLines(f.content) } catch { /* gone */ }
    }
    const hunks = current ? diffLines(splitLines(edit.baseline), current) : []
    const { add, del } = diffStat(hunks)
    const h = hunks[0]
    return { edit, add, del, first: h ? Math.max(1, h.modCount > 0 ? h.modStart + 1 : h.modStart) : 1 }
  }))
}

/** Title-bar button: "N changes" → list of Claude's edited files; click opens at the first change. */
export function ClaudeChanges({ projectId, root }: { projectId: string; root: string }) {
  const all = useEdits(s => s.edits)
  const mine = useMemo(() => {
    const r = fileKey(root) + '/'
    return Object.values(all).filter(e => fileKey(e.path).startsWith(r))
  }, [all, root])
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    void rowsFor(mine).then(r => { if (alive) setRows(r) })
    return () => { alive = false }
  }, [open, mine])

  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc) }
  }, [open])

  if (!mine.length) return null
  return (
    <div className="ai-changes nodrag" ref={boxRef}>
      <button className={`ai-changes-btn${open ? ' active' : ''}`} title="Files Claude changed (not reviewed yet)" onClick={() => setOpen(!open)}>
        <span className="ai-changes-star">✦</span>{mine.length} file{mine.length > 1 ? 's' : ''} changed
      </button>
      {open && (
        <div className="ai-changes-pop">
          <div className="ai-changes-head">
            <span>Claude's changes</span>
            <button className="ai-review-btn acc" title="Accept every change in every file"
              onClick={() => { mine.forEach(e => window.arw.edits.set(e.path, null)); setOpen(false) }}>Accept all</button>
          </div>
          {(rows ?? mine.map(edit => ({ edit, add: 0, del: 0, first: 1 }))).map(r => (
            <div key={r.edit.path} className="ai-changes-row" title={r.edit.path}
              onClick={() => { useIde.getState().openFile(projectId, r.edit.path, r.first); setOpen(false) }}>
              <FileIcon name={baseName(r.edit.path)} />
              <span className="ai-changes-name">{baseName(r.edit.path)}</span>
              <span className="ai-changes-dir">{relativeTo(root, r.edit.path).split('/').slice(0, -1).join('/')}</span>
              {r.edit.created && <span className="ai-changes-new">new</span>}
              {rows && <span className="ai-changes-stat"><b className="add">+{r.add}</b> <b className="del">−{r.del}</b></span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
