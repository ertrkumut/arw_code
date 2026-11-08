/**
 * Chat view model for a Claude pane.
 *
 * Claude Code runs headless (`claude -p --input-format stream-json --output-format
 * stream-json --verbose --include-partial-messages`) and prints one JSON event per line:
 *   system/init · stream_event (live deltas) · assistant (finished content blocks) ·
 *   user (tool results) · result (turn finished) · rate_limit_event …
 * Saved transcripts (~/.claude/projects/…/<session>.jsonl) hold the same assistant/user
 * messages, so history and live output go through the same reducer.
 *
 * Pure and framework-free: the renderer keeps one ChatState per pane and folds events in.
 */

export interface DiffHunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

export type ChatItem =
  | { kind: 'user'; id: string; text: string; images: string[] }
  | { kind: 'text'; id: string; text: string; parent?: string }
  | { kind: 'thinking'; id: string; text: string; ms?: number; parent?: string }
  | { kind: 'tool'; id: string; name: string; input: any; status: 'running' | 'done' | 'error'
      result?: string; patch?: DiffHunk[]; parent?: string }
  | { kind: 'turn'; id: string; ms: number; stopped?: boolean; error?: string }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'error' }
  /** output of a /command Claude ran itself (e.g. /context, /cost) */
  | { kind: 'command'; id: string; text: string }
  | { kind: 'compacted'; id: string }

export interface ChatState {
  items: ChatItem[]
  /** live text / thinking of the block being streamed right now (top-level only) */
  liveText: string
  liveThinking: string
  thinkingStartedAt: number | null
  busy: boolean
  /** when the current turn started (for the "working…" timer) */
  turnStartedAt: number | null
  sessionId: string | null
  model: string | null
  /** slash commands Claude reported at startup (skills and MCP prompts included) */
  slashCommands: string[]
  /** of those, the ones that only work in the interactive terminal */
  terminalCommands: string[]
  /** USD spent by this chat's Claude process so far (Claude reports it cumulatively). */
  costUsd: number | null
  /** Tokens in the context window as of the latest main-thread reply. */
  contextTokens: number | null
  /** Size of the model's context window, once Claude reports it. */
  contextWindow: number | null
}

/** One plan-usage window (fraction 0..1 of the limit used, reset as epoch seconds). */
export interface LimitWindow { used: number; resetsAt: number }
/** Account-wide plan usage, as Claude reports it in `rate_limit_event`. */
export interface UsageLimits { fiveHour: LimitWindow | null; sevenDay: LimitWindow | null; ts: number }

const limitWindow = (w: any): LimitWindow | null =>
  w && typeof w.utilization === 'number' ? { used: w.utilization, resetsAt: Number(w.resetsAt) || 0 } : null

/** Plan usage out of a `rate_limit_event`, or null when it carries none. */
export function limitsFromEvent(e: any, now = Date.now()): UsageLimits | null {
  if (e?.type !== 'rate_limit_event') return null
  const info = e.rate_limit_info ?? {}
  const win = info.unifiedWindows ?? {}
  let fiveHour = limitWindow(win.five_hour)
  const sevenDay = limitWindow(win.seven_day)
  // Older CLIs only send the top-level fields for the window that applies.
  if (!fiveHour && info.rateLimitType === 'five_hour' && typeof info.utilization === 'number')
    fiveHour = { used: info.utilization, resetsAt: Number(info.resetsAt) || 0 }
  return fiveHour || sevenDay ? { fiveHour, sevenDay, ts: now } : null
}

/** Context window of the conversation's model from a result's `modelUsage` (subagents may use others). */
function contextWindowOf(modelUsage: any, model: string | null): number | null {
  if (!modelUsage || typeof modelUsage !== 'object') return null
  const entries = Object.entries(modelUsage).filter(([, v]: any) => typeof v?.contextWindow === 'number') as [string, any][]
  if (!entries.length) return null
  const want = (model ?? '').replace(/\[1m\]$/i, '').toLowerCase()
  const hit = want && entries.find(([k]) => k.toLowerCase() === want || k.toLowerCase().startsWith(want) || want.startsWith(k.toLowerCase()))
  return hit ? hit[1].contextWindow : Math.max(...entries.map(([, v]) => v.contextWindow))
}

export const emptyChat = (): ChatState => ({
  items: [], liveText: '', liveThinking: '', thinkingStartedAt: null, busy: false, turnStartedAt: null, sessionId: null, model: null,
  slashCommands: [], terminalCommands: [], costUsd: null, contextTokens: null, contextWindow: null
})

let seq = 0
const hash = (t: string) => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }
const nid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

/** Text out of a tool_result content (string or [{type:'text',text}…]). */
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c: any) => (c?.type === 'text' ? c.text : c?.type === 'image' ? '[image]' : '')).join('\n')
  return ''
}

/** `<command-name>/mcp</command-name><command-args>x</command-args>` → "/mcp x" */
function commandEcho(text: string): string | null {
  const name = /<command-name>\s*(\/?[^<\s]+)\s*<\/command-name>/.exec(text)?.[1]
  if (!name) return null
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim()
  return `${name.startsWith('/') ? name : '/' + name}${args ? ' ' + args : ''}`
}

/** `<local-command-stdout>…</local-command-stdout>` → its text */
export function commandOutput(content: unknown): string | null {
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n') : ''
  const m = /<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/.exec(text)
  return m ? m[1].trim() : null
}

/** A user transcript line is a real prompt (not a tool result, hook output or /command wrapper). */
function promptOf(content: unknown): { text: string; images: string[] } | null {
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
  if (blocks.some((b: any) => b?.type === 'tool_result')) return null
  const text = blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text as string).join('\n').trim()
  const images = blocks
    .filter((b: any) => b?.type === 'image' && b.source?.type === 'base64')
    .map((b: any) => `data:${b.source.media_type};base64,${b.source.data}`)
  if (!text && !images.length) return null
  const cmd = commandEcho(text)
  if (cmd) return { text: cmd, images: [] }
  if (text.startsWith('<') && /^<(command-|local-command|system-reminder|user-prompt-submit-hook)/.test(text)) return null
  // The summary /compact feeds back in is not something the user typed.
  if (text.startsWith('This session is being continued from a previous conversation')) return null
  return { text, images }
}

const updateTool = (items: ChatItem[], id: string, f: (t: Extract<ChatItem, { kind: 'tool' }>) => ChatItem) =>
  items.map(it => (it.kind === 'tool' && it.id === id ? f(it) : it))

/** Fold one event (live stream line, transcript line, or ARW's own echo) into the chat. */
export function applyEvent(s: ChatState, e: any, now = Date.now()): ChatState {
  if (!e || typeof e !== 'object') return s
  const parent: string | undefined = e.parent_tool_use_id ?? e.parentToolUseID ?? undefined

  switch (e.type) {
    // ARW echoes each prompt it sends so every window shows it (Claude doesn't echo input).
    case 'arw_user':
      return { ...s, busy: true, turnStartedAt: s.turnStartedAt ?? now,
        items: [...s.items, { kind: 'user', id: nid('u'), text: e.text ?? '', images: e.images ?? [] }] }

    case 'arw_notice':
      return { ...s, items: [...s.items, { kind: 'notice', id: nid('n'), text: String(e.text ?? ''), tone: e.tone === 'error' ? 'error' : 'info' }] }

    case 'arw_exit':
      // Claude process ended. Mid-turn means it crashed or was killed.
      if (!s.busy) return s
      return { ...s, busy: false, turnStartedAt: null, liveText: '', liveThinking: '', thinkingStartedAt: null,
        items: [...s.items, { kind: 'notice', id: nid('n'), text: e.text || 'Claude stopped unexpectedly.', tone: 'error' }] }

    case 'system':
      if (e.subtype === 'init') return { ...s, sessionId: e.session_id ?? s.sessionId, model: e.model ?? s.model,
        slashCommands: Array.isArray(e.slash_commands) ? e.slash_commands : s.slashCommands,
        terminalCommands: Array.isArray(e.terminal_slash_commands) ? e.terminal_slash_commands : s.terminalCommands }
      if (e.subtype === 'compact_boundary') return { ...s, items: [...s.items, { kind: 'compacted', id: e.uuid ?? nid('c') }] }
      return s

    case 'stream_event': {
      if (parent) return s                                  // subagent output: shown inside its Task card
      const ev = e.event ?? {}
      if (ev.type === 'content_block_start') {
        const t = ev.content_block?.type
        if (t === 'thinking') return { ...s, liveThinking: '', thinkingStartedAt: now }
        if (t === 'text') return { ...s, liveText: '' }
        return s
      }
      if (ev.type === 'content_block_delta') {
        const d = ev.delta ?? {}
        if (d.type === 'text_delta') return { ...s, liveText: s.liveText + (d.text ?? '') }
        if (d.type === 'thinking_delta') return { ...s, liveThinking: s.liveThinking + (d.thinking ?? '') }
      }
      return s
    }

    case 'assistant': {
      const blocks: any[] = Array.isArray(e.message?.content) ? e.message.content : []
      const msgId: string = e.message?.id ?? nid('m')
      let items = s.items, next = s
      // Everything the model just read plus what it wrote is what the context now holds.
      const u = e.message?.usage
      if (!parent && u && typeof u.input_tokens === 'number')
        next = { ...next, contextTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0) }
      blocks.forEach((b, i) => {
        // Live output and transcripts send one block per event, so the index isn't unique —
        // key text/thinking blocks by a hash of their content.
        const id = `${msgId}:${b.id ?? hash(b.text ?? b.thinking ?? String(i))}:${b.type}`
        if (items.some(x => x.id === id)) return             // transcript + live overlap
        if (b.type === 'text' && b.text?.trim()) {
          items = [...items, { kind: 'text', id, text: b.text, parent }]
          if (!parent) next = { ...next, liveText: '' }
        } else if (b.type === 'thinking' && (b.thinking ?? '').trim()) {
          const ms = !parent && s.thinkingStartedAt ? now - s.thinkingStartedAt : undefined
          items = [...items, { kind: 'thinking', id, text: b.thinking, ms, parent }]
          if (!parent) next = { ...next, liveThinking: '', thinkingStartedAt: null }
        } else if (b.type === 'tool_use') {
          if (items.some(x => x.kind === 'tool' && x.id === b.id)) return
          items = [...items, { kind: 'tool', id: b.id, name: b.name, input: b.input ?? {}, status: 'running', parent }]
        }
      })
      return { ...next, items }
    }

    case 'user': {
      const content = e.message?.content
      const structured = e.tool_use_result ?? e.toolUseResult
      if (Array.isArray(content) && content.some((b: any) => b?.type === 'tool_result')) {
        let items = s.items
        for (const b of content) {
          if (b?.type !== 'tool_result') continue
          const patch: DiffHunk[] | undefined = Array.isArray(structured?.structuredPatch) ? structured.structuredPatch : undefined
          items = updateTool(items, b.tool_use_id, t => ({
            ...t, status: b.is_error ? 'error' : 'done', result: toolResultText(b.content), patch: patch ?? t.patch
          }))
        }
        return { ...s, items }
      }
      if (parent || e.isSidechain || e.isCompactSummary) return s
      // What a /command printed (live and in transcripts).
      const out = commandOutput(content)
      if (out !== null) {
        if (!out || s.items.some(x => x.id === (e.uuid ?? ''))) return s
        return { ...s, items: [...s.items, { kind: 'command', id: e.uuid ?? nid('o'), text: out }] }
      }
      // Transcript prompt (live prompts arrive as arw_user instead).
      if (e.isMeta) return s
      const p = promptOf(content)
      if (!p) return s
      return { ...s, items: [...s.items, { kind: 'user', id: e.uuid ?? nid('u'), text: p.text, images: p.images }] }
    }

    case 'result': {
      const stopped = e.subtype === 'error_during_execution'
      const error = !stopped && e.subtype && e.subtype !== 'success' ? String(e.subtype).replace(/_/g, ' ') : (e.is_error ? String(e.result ?? 'error') : undefined)
      const ms = typeof e.duration_ms === 'number' ? e.duration_ms : (s.turnStartedAt ? now - s.turnStartedAt : 0)
      // Tools still "running" when the turn ends were cut off.
      const items = s.items.map(it => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'error' as const, result: it.result ?? (stopped ? 'Stopped' : '') } : it))
      return { ...s, busy: false, turnStartedAt: null, liveText: '', liveThinking: '', thinkingStartedAt: null,
        sessionId: e.session_id ?? s.sessionId,
        costUsd: typeof e.total_cost_usd === 'number' ? e.total_cost_usd : s.costUsd,
        contextWindow: contextWindowOf(e.modelUsage, s.model) ?? s.contextWindow,
        items: [...items, { kind: 'turn', id: nid('t'), ms, stopped, error }] }
    }
  }
  return s
}

/** Build a chat from a saved transcript (JSONL text). */
export function chatFromTranscript(jsonl: string): ChatState {
  let s = emptyChat()
  for (const line of jsonl.split('\n')) {
    if (!line.startsWith('{"') || !(line.includes('"type":"user"') || line.includes('"type":"assistant"'))) continue
    try { s = applyEvent(s, JSON.parse(line)) } catch { /* partial line */ }
  }
  // A transcript has no `result` lines; nothing in it is running anymore.
  return { ...s, busy: false, items: s.items.map(it => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'done' as const } : it)) }
}

/** "1m 12s", "6s" */
export function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
