import React, { useEffect, useRef, useState } from 'react'

/**
 * A popup opened by a keypress mounts while that same key event is still bubbling, and React
 * attaches its effects synchronously for input events — so the popup would see the Enter
 * that opened it. Ignore any key event older than the mount.
 */
function useKeys(handler: (e: KeyboardEvent) => void, deps: unknown[]) {
  const mountedAt = useRef(performance.now())
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.timeStamp > mountedAt.current) handler(e) }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, deps)
}
import { useChat } from '../../store/chatStore'

/** Shared frame: Esc / backdrop close, title row, body, footer. */
function Frame({ title, sub, onClose, children, footer, wide }: {
  title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean
}) {
  useKeys((e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }, [onClose])
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className={`modal-card chd-card${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title" style={{ marginBottom: sub ? 2 : 10 }}>{title}</div>
        {sub && <div className="history-sub">{sub}</div>}
        {children}
        <div className="modal-actions">{footer}<button className="btn-soft" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- /mcp
interface McpServer {
  name: string
  status: string            // connected | pending | connecting | failed | needs-auth | disabled
  source?: string
  scope?: string
  transport?: string
  serverInfo?: { name?: string; version?: string }
  tools?: { name: string }[]
  error?: string
}

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected', pending: 'Connecting…', connecting: 'Connecting…', failed: 'Failed',
  'needs-auth': 'Needs sign-in', disabled: 'Disabled'
}

function McpDialog({ termId, onClose }: { termId: string; onClose: () => void }) {
  const control = useChat(s => s.control)
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)       // server name with an action in flight
  const [showHidden, setShowHidden] = useState(false)

  const refresh = async () => {
    try {
      const r = await control(termId, 'mcp_status')
      setServers(Array.isArray(r?.mcpServers) ? r.mcpServers : [])
      setErr(null)
    } catch (e: any) { setErr(String(e?.message ?? e)); setServers(s => s ?? []) }
  }
  useEffect(() => { void refresh() }, [termId])

  const act = async (name: string, subtype: string, extra: Record<string, unknown> = {}) => {
    setBusy(name)
    try {
      const r = await control(termId, subtype, { serverName: name, ...extra })
      // Sign-in hands back a URL the browser must open; the server connects once that's done.
      if (subtype === 'mcp_authenticate' && r?.authUrl) window.arw.openExternal(r.authUrl)
      await new Promise(res => setTimeout(res, 600))
      await refresh()
    } catch (e: any) { setErr(`${name}: ${e?.message ?? e}`) }
    finally { setBusy(null) }
  }

  // claude.ai connectors you haven't signed into are noise — tuck them away like Claude does.
  const isHiddenConnector = (s: McpServer) => s.source === 'claudeai' && s.status === 'needs-auth'
  const visible = (servers ?? []).filter(s => showHidden || !isHiddenConnector(s))
  const hiddenCount = (servers ?? []).filter(isHiddenConnector).length
  const groups = [
    ['Your servers', visible.filter(s => s.source !== 'claudeai' && s.source !== 'plugin')],
    ['Plugins', visible.filter(s => s.source === 'plugin')],
    ['claude.ai connectors', visible.filter(s => s.source === 'claudeai')]
  ] as const
  const counts = servers ? `${servers.length} servers · ${servers.filter(s => s.status === 'connected').length} connected` : ''

  return (
    <Frame title="MCP servers" sub={counts} onClose={onClose} wide
      footer={<button className="btn-soft" onClick={() => void refresh()} disabled={servers === null}>Refresh</button>}>
      {err && <div className="modal-err">{err}</div>}
      <div className="history-list scroll-slim chd-list">
        {servers === null && <div className="history-empty">Asking Claude…</div>}
        {servers?.length === 0 && !err && <div className="history-empty">No MCP servers configured.</div>}
        {groups.map(([label, list]) => list.length > 0 && (
          <React.Fragment key={label}>
            <div className="chd-group">{label}</div>
            {list.map(s => {
              const st = s.status
              const on = st !== 'disabled'
              return (
                <div key={s.name} className={`history-row chd-row ${st}`}>
                  <span className={`chd-dot ${st}`} />
                  <div className="history-main" title={s.error ?? s.name}>
                    <div className="history-title">{s.name}</div>
                    <div className="history-meta">
                      {STATUS_LABEL[st] ?? st}{s.tools?.length ? ` · ${s.tools.length} tool${s.tools.length === 1 ? '' : 's'}` : ''}
                      {s.serverInfo?.version ? ` · v${s.serverInfo.version}` : ''}{s.transport ? ` · ${s.transport}` : ''}
                      {s.error ? ` · ${s.error.slice(0, 80)}` : ''}
                    </div>
                  </div>
                  {busy === s.name ? <span className="ch-spin" /> : (
                    <>
                      {st === 'needs-auth' && <button className="btn-modal" onClick={() => void act(s.name, 'mcp_authenticate')}>Sign in</button>}
                      {on && st !== 'needs-auth' && <button className="btn-soft" onClick={() => void act(s.name, 'mcp_reconnect')}>Reconnect</button>}
                      <button className="btn-soft" onClick={() => void act(s.name, 'mcp_toggle', { enabled: !on })}>{on ? 'Disable' : 'Enable'}</button>
                    </>
                  )}
                </div>
              )
            })}
          </React.Fragment>
        ))}
        {hiddenCount > 0 && (
          <button className="chd-more" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? 'Hide' : 'Show'} {hiddenCount} unused claude.ai connector{hiddenCount === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------- /model
/** Aliases Claude Code accepts for `/model` (from its own usage line). */
const MODELS: { id: string; name: string; note: string }[] = [
  { id: 'default', name: 'Default', note: 'Your account default' },
  { id: 'fable', name: 'Fable 5.1', note: 'Most capable' },
  { id: 'opus', name: 'Opus 5.5', note: 'Deep reasoning' },
  { id: 'sonnet', name: 'Sonnet 5.5', note: 'Balanced' },
  { id: 'haiku', name: 'Haiku 5.5', note: 'Fastest, cheapest' },
  { id: 'best', name: 'Best available', note: 'Picks the strongest model you can use' },
  { id: 'opusplan', name: 'Opus plan', note: 'Opus for planning, Sonnet for execution' },
  { id: 'fable[1m]', name: 'Fable 5.1 · 1M context', note: 'Long context' },
  { id: 'opus[1m]', name: 'Opus 5.5 · 1M context', note: 'Long context' },
  { id: 'sonnet[1m]', name: 'Sonnet 5.5 · 1M context', note: 'Long context' }
]

function ModelDialog({ termId, onClose }: { termId: string; onClose: () => void }) {
  const current = useChat(s => s.chats[termId]?.model) ?? null
  const setModel = useChat(s => s.setModel)
  const [custom, setCustom] = useState('')
  const [idx, setIdx] = useState(() => Math.max(0, MODELS.findIndex(m => current?.includes(m.id.replace(/\[1m\]$/, '')))))
  const pick = async (id: string) => { onClose(); await setModel(termId, id) }
  const isCurrent = (m: typeof MODELS[number]) => !!current && !m.id.includes('[') && m.id !== 'default' && m.id !== 'best' && m.id !== 'opusplan' && current.includes(m.id)

  useKeys((e) => {
    if (document.activeElement?.classList.contains('chd-input')) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(MODELS.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); void pick(MODELS[idx].id) }
  }, [idx])

  return (
    <Frame title="Model" sub={current ? <>Current: <code>{current}</code> · this conversation only</> : 'Pick a model for this conversation'} onClose={onClose}>
      <div className="chd-list">
        {MODELS.map((m, i) => (
          <div key={m.id} className={`goto-row chd-model${i === idx ? ' active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => void pick(m.id)}>
            <span className="chd-model-name">{m.name}</span>
            <span className="goto-dir">{m.note}</span>
            {isCurrent(m) && <span className="chd-current">current</span>}
          </div>
        ))}
        <form className="chd-custom" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) void pick(custom.trim()) }}>
          <input className="goto-input chd-input" placeholder="…or a full model ID, e.g. claude-sonnet-5-5" value={custom} onChange={(e) => setCustom(e.target.value)} />
        </form>
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------- /resume
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

function ResumeDialog({ termId, cwd, onClose }: { termId: string; cwd: string; onClose: () => void }) {
  const current = useChat(s => s.chats[termId]?.sessionId)
  const switchSession = useChat(s => s.switchSession)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  useEffect(() => { window.arw.history.list(cwd).then(setSessions).catch(() => setSessions([])) }, [cwd])
  const list = (sessions ?? []).filter(s => !q || s.title.toLowerCase().includes(q.toLowerCase()))
  const pick = async (s: Session) => { onClose(); await switchSession(termId, s.id) }
  return (
    <Frame title="Continue a conversation" sub="Switches this pane to the saved conversation" onClose={onClose} wide>
      <input autoFocus className="goto-input chd-input" placeholder="Search conversations…" value={q}
        onChange={(e) => { setQ(e.target.value); setIdx(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(list.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
          else if (e.key === 'Enter' && list[idx]) { e.preventDefault(); void pick(list[idx]) }
        }} />
      <div className="history-list scroll-slim chd-list">
        {sessions === null && <div className="history-empty">Loading…</div>}
        {sessions && list.length === 0 && <div className="history-empty">No saved conversations{q ? ' match' : ' for this folder'}.</div>}
        {list.map((s, i) => (
          <div key={s.id} className={`history-row chd-row${i === idx ? ' active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => void pick(s)}>
            <div className="history-main" title={s.title}>
              <div className="history-title">{s.title}</div>
              <div className="history-meta">{ago(s.updatedAt)} · {s.id.slice(0, 8)}{s.id === current ? ' · this conversation' : ''}</div>
            </div>
            {s.id !== current && <button className="btn-modal" onClick={(e) => { e.stopPropagation(); void pick(s) }}>Continue</button>}
          </div>
        ))}
      </div>
    </Frame>
  )
}

/** Mounts whichever /command popup is open for this pane. */
export function ChatDialogs({ termId, cwd }: { termId: string; cwd: string }) {
  const dialog = useChat(s => s.dialog)
  const close = useChat(s => s.closeDialog)
  if (!dialog || dialog.termId !== termId) return null
  if (dialog.kind === 'mcp') return <McpDialog termId={termId} onClose={close} />
  if (dialog.kind === 'model') return <ModelDialog termId={termId} onClose={close} />
  return <ResumeDialog termId={termId} cwd={cwd} onClose={close} />
}
