import React, { useEffect, useState } from 'react'
import { useApp } from '../store/appStore'

type Session = Awaited<ReturnType<typeof window.arw.history.list>>[number]

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString()
}
const size = (b: number) =>
  b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`

/** Lists the Claude Code conversations saved for a project folder. Each row can be
 *  resumed (opens a new terminal running `claude --resume <id>`) or deleted from disk.
 *  Delete is two-click: the first click arms the row, the second removes it. */
export function HistoryDialog() {
  const req = useApp(s => s.historyFor)
  const project = useApp(s => s.projects.find(p => p.id === s.historyFor?.projectId))
  const closeHistory = useApp(s => s.closeHistory)
  const resumeSession = useApp(s => s.resumeSession)

  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return
    setSessions(null); setArmed(null); setErr(null)
    window.arw.history.list(project.path).then(setSessions)
      .catch(e => { setErr(String(e)); setSessions([]) })
  }, [project?.path])

  useEffect(() => {
    if (!req) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeHistory() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [req])

  if (!req || !project) return null

  const remove = async (s: Session) => {
    if (armed !== s.id) { setArmed(s.id); return }
    setArmed(null)
    try {
      await window.arw.history.remove(project.path, s.id)
      setSessions(list => list?.filter(x => x.id !== s.id) ?? null)
    } catch (e) { setErr(`Could not delete: ${e instanceof Error ? e.message : e}`) }
  }

  const total = sessions?.reduce((n, s) => n + s.sizeBytes, 0) ?? 0
  return (
    <div className="modal-overlay" onMouseDown={closeHistory}>
      <div className="modal-card history-card" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Conversation history · {project.name}</div>
        <div className="history-sub">
          Claude Code{sessions && sessions.length > 0 && <> · {sessions.length} sessions · {size(total)}</>}
        </div>
        {err && <div className="modal-err">{err}</div>}
        <div className="history-list scroll-slim">
          {sessions === null && <div className="history-empty">Loading…</div>}
          {sessions?.length === 0 && <div className="history-empty">No saved Claude conversations for this folder.</div>}
          {sessions?.map(s => (
            <div key={s.id} className="history-row" onMouseLeave={() => armed === s.id && setArmed(null)}>
              <div className="history-main" title={s.title}>
                <div className="history-title">{s.title}</div>
                <div className="history-meta">{ago(s.updatedAt)} · {size(s.sizeBytes)} · {s.id.slice(0, 8)}</div>
              </div>
              <button className="btn-modal" onClick={() => resumeSession(project.id, s.id, s.title)}>Continue</button>
              <button className="btn-modal danger" onClick={() => remove(s)}>
                {armed === s.id ? 'Confirm' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn-soft" onClick={closeHistory}>Close</button>
        </div>
      </div>
    </div>
  )
}
