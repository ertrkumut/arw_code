/**
 * Codex CLI → chat events.
 *
 * A Codex chat pane runs `codex exec --json` once per prompt (`codex exec resume <thread>`
 * after the first). Codex prints one JSON event per line:
 *   thread.started · turn.started · item.started / item.updated / item.completed ·
 *   turn.completed · turn.failed · error
 * Items are agent_message, reasoning, command_execution, file_change, mcp_tool_call,
 * web_search, todo_list and error.
 *
 * Rather than teach the chat reducer a second dialect, each Codex event is turned into the
 * Claude stream-json events it corresponds to, so the same view renders both agents.
 * Pure and framework-free.
 */

import type { LimitWindow, UsageLimits } from './chatModel'

export interface CodexTurn {
  /** item ids already shown as a tool card (so completion updates the card, not adds one) */
  started: Set<string>
  startedAt: number
  /** last error Codex reported; shown only if the turn ends without turn.failed */
  lastError?: string
}

export const newCodexTurn = (now = Date.now()): CodexTurn => ({ started: new Set(), startedAt: now })

/** Codex's own retry chatter ("Reconnecting... 2/5", transport fallback) — not worth a notice. */
const isTransient = (m: unknown) => /^(Reconnecting\.\.\.|Falling back from WebSockets)/.test(String(m ?? ''))

/** A 401 means the CLI was never signed in; say how to fix it. */
const friendly = (m: string) => /401 Unauthorized|not logged in/i.test(m)
  ? `Codex isn't signed in. Click ›_ on this pane (or open a Codex terminal), run \`codex login\`, then come back. (${m.split(',')[0]})` : m

const assistant = (id: string, content: any[]) => ({ type: 'assistant', message: { id, content } })
const toolResult = (id: string, text: string, isError: boolean) =>
  ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] } })

/** The tool card(s) an item is shown as: Claude tool name + input. */
function toolsOf(item: any): { id: string; name: string; input: any }[] {
  switch (item?.type) {
    case 'command_execution': return [{ id: item.id, name: 'Bash', input: { command: String(item.command ?? '') } }]
    case 'web_search': return [{ id: item.id, name: 'WebSearch', input: { query: String(item.query ?? '') } }]
    case 'mcp_tool_call': return [{ id: item.id, name: `mcp__${item.server ?? 'mcp'}__${item.tool ?? 'tool'}`, input: item.arguments ?? {} }]
    case 'todo_list': return [{ id: item.id, name: 'TodoWrite', input: { todos: (Array.isArray(item.items) ? item.items : [])
      .map((t: any) => ({ content: String(t?.text ?? ''), status: t?.completed ? 'completed' : 'pending' })) } }]
    case 'file_change': return (Array.isArray(item.changes) ? item.changes : []).map((c: any, i: number) => ({
      id: `${item.id}:${i}`, name: c?.kind === 'add' ? 'Write' : 'Edit',
      input: { file_path: String(c?.path ?? ''), ...(c?.kind === 'delete' ? { deleted: true } : {}) }
    }))
  }
  return []
}

function mcpResultText(r: any): string {
  if (!r) return ''
  if (typeof r === 'string') return r
  if (Array.isArray(r.content)) return r.content.map((c: any) => (c?.type === 'text' ? c.text : '')).join('\n')
  try { return JSON.stringify(r, null, 2) } catch { return '' }
}

/** Translate one Codex JSON event into zero or more chat events. */
export function codexToChat(ev: any, turn: CodexTurn, now = Date.now()): any[] {
  if (!ev || typeof ev !== 'object') return []
  switch (ev.type) {
    case 'thread.started':
      return [{ type: 'system', subtype: 'init', session_id: ev.thread_id }]

    case 'item.started':
    case 'item.updated':
    case 'item.completed': {
      const item = ev.item ?? {}
      const done = ev.type === 'item.completed'
      if (item.type === 'agent_message') return done && item.text?.trim() ? [assistant(item.id, [{ type: 'text', text: item.text }])] : []
      if (item.type === 'reasoning') return done && item.text?.trim() ? [assistant(item.id, [{ type: 'thinking', thinking: item.text }])] : []
      if (item.type === 'error') return done && !isTransient(item.message) ? [{ type: 'arw_notice', tone: 'error', text: String(item.message ?? 'Codex error') }] : []

      const out: any[] = []
      const tools = toolsOf(item)
      const fresh = tools.filter(t => !turn.started.has(t.id))
      if (fresh.length) {
        for (const t of fresh) turn.started.add(t.id)
        out.push(assistant(`codex-${item.id}`, fresh.map(t => ({ type: 'tool_use', ...t }))))
      }
      if (!done) return out
      const failed = item.status === 'failed' || (item.type === 'command_execution' && typeof item.exit_code === 'number' && item.exit_code !== 0)
      for (const t of tools) {
        let text = ''
        if (item.type === 'command_execution') text = String(item.aggregated_output ?? '') + (typeof item.exit_code === 'number' && item.exit_code ? `\n(exit code ${item.exit_code})` : '')
        else if (item.type === 'mcp_tool_call') text = item.error?.message ? String(item.error.message) : mcpResultText(item.result)
        out.push(toolResult(t.id, text, failed))
      }
      return out
    }

    case 'turn.completed': {
      const u = ev.usage ?? {}
      return [{ type: 'result', subtype: 'success', duration_ms: now - turn.startedAt,
        usage: { input_tokens: u.input_tokens ?? 0, cached_input_tokens: u.cached_input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 } }]
    }
    case 'turn.failed':
      // No subtype: the chat then shows `result` (the message) as the turn's error.
      return [{ type: 'result', is_error: true, result: friendly(String(ev.error?.message ?? 'Codex failed')), duration_ms: now - turn.startedAt }]
    case 'error':
      // Retries are noise, and the final error is repeated by turn.failed — keep it in case
      // the process dies before that arrives.
      if (!isTransient(ev.message)) turn.lastError = friendly(String(ev.message ?? 'Codex error'))
      return []
  }
  return []
}

/**
 * A saved Codex session (`~/.codex/sessions/…/rollout-…-<thread>.jsonl`) as chat transcript
 * lines. Only what was said is kept: `event_msg` user_message / agent_message carry the
 * prompt as typed (the response_item copies also hold injected context like AGENTS.md).
 */
export function codexRolloutToTranscript(jsonl: string): string {
  const out: string[] = []
  let n = 0
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"event_msg"')) continue
    let ev: any
    try { ev = JSON.parse(line) } catch { continue }
    const p = ev?.payload
    if (ev?.type !== 'event_msg' || !p) continue
    if (p.type === 'user_message' && typeof p.message === 'string' && p.message.trim())
      out.push(JSON.stringify({ type: 'user', uuid: `cx-u-${n++}`, message: { role: 'user', content: p.message } }))
    else if (p.type === 'agent_message' && typeof p.message === 'string' && p.message.trim())
      out.push(JSON.stringify({ type: 'assistant', message: { id: `cx-a-${n++}`, content: [{ type: 'text', text: p.message }] } }))
  }
  return out.join('\n')
}

/** One Codex rate-limit window as stored in `token_count` events. */
interface CodexWindow { used_percent?: number; window_minutes?: number; resets_at?: number; resets_in_seconds?: number }

export interface CodexUsage {
  /** account-wide plan usage (null when Codex hasn't reported any yet) */
  limits: UsageLimits | null
  /** tokens in the conversation's context after the last reply, and the model's window */
  contextTokens: number | null
  contextWindow: number | null
}

function codexWindow(w: CodexWindow | null | undefined, eventMs: number): LimitWindow | null {
  if (!w || typeof w.used_percent !== 'number') return null
  const resetsAt = typeof w.resets_at === 'number' ? w.resets_at
    : typeof w.resets_in_seconds === 'number' ? Math.round(eventMs / 1000 + w.resets_in_seconds) : 0
  return { used: w.used_percent / 100, resetsAt }
}

/**
 * Plan limits and context fill out of a Codex session file: the last `token_count` event
 * (`payload.rate_limits.primary/secondary`, `payload.info.last_token_usage`). Codex's 5-hour
 * window is normally `primary` and the weekly one `secondary`; window_minutes decides when present.
 */
export function codexUsageFromRollout(jsonl: string, now = Date.now()): CodexUsage {
  const out: CodexUsage = { limits: null, contextTokens: null, contextWindow: null }
  const lines = jsonl.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.includes('"token_count"')) continue
    let ev: any
    try { ev = JSON.parse(line) } catch { continue }
    const p = ev?.payload
    if (p?.type !== 'token_count') continue
    const eventMs = Date.parse(ev.timestamp ?? '') || now
    if (out.contextTokens === null && p.info) {
      const last = p.info.last_token_usage ?? {}
      const used = typeof last.total_tokens === 'number' ? last.total_tokens
        : (last.input_tokens ?? 0) + (last.output_tokens ?? 0) || null
      out.contextTokens = used
      out.contextWindow = typeof p.info.model_context_window === 'number' ? p.info.model_context_window : null
    }
    if (!out.limits && p.rate_limits) {
      const ws = [p.rate_limits.primary, p.rate_limits.secondary].filter(Boolean) as CodexWindow[]
      let five = ws.find(w => (w.window_minutes ?? 0) > 0 && (w.window_minutes ?? 0) <= 360)
      let week = ws.find(w => (w.window_minutes ?? 0) >= 1440)
      if (!five && !week) { five = p.rate_limits.primary; week = p.rate_limits.secondary }
      const fiveHour = codexWindow(five, eventMs), sevenDay = codexWindow(week, eventMs)
      if (fiveHour || sevenDay) out.limits = { fiveHour, sevenDay, ts: eventMs }
    }
    if (out.limits && out.contextTokens !== null) break
  }
  return out
}

/** "5-hour: 42% used, resets 3:30pm" lines for /usage and /status. */
export function describeCodexLimits(l: UsageLimits | null, now = Date.now()): string {
  if (!l) return 'No usage reported yet — Codex reports plan limits after your first message (ChatGPT sign-in only; API keys have no plan limits).'
  const line = (name: string, w: LimitWindow | null) => {
    if (!w) return `${name}: --`
    const when = w.resetsAt ? new Date(w.resetsAt * 1000) : null
    const stale = when && when.getTime() < now
    return `${name}: ${stale ? 'reset since last reading' : `${Math.round(w.used * 100)}% used`}${when && !stale ? `, resets ${when.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`
  }
  return [line('5-hour limit', l.fiveHour), line('Weekly limit', l.sevenDay), `(as of ${new Date(l.ts).toLocaleTimeString()})`].join('\n')
}
