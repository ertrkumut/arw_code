import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'child_process'
import { readdirSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { SESSION_ID_RE } from './claudeHistory'
import { codexToChat, codexRolloutToTranscript, newCodexTurn, codexUsageFromRollout, describeCodexLimits, type CodexUsage } from '@shared/codexEvents'
import type { ContentBlock } from './chatManager'

/**
 * Chat panes for Codex CLI. Unlike Claude, `codex exec` takes one prompt and exits, so each
 * prompt is its own process:
 *
 *   codex exec --json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check
 *              [-i <image>…] [resume <thread>] -          (prompt on stdin)
 *
 * The thread id from the first run's `thread.started` is kept and resumed on every later
 * prompt, so it is one conversation. Events are translated to the Claude chat shape
 * (shared/codexEvents.ts), so the renderer shows them with the same view.
 */

interface CodexChat {
  cwd: string
  /** Codex thread id; null until the first prompt starts one */
  threadId: string | null
  proc: ChildProcessWithoutNullStreams | null
  /** prompts typed while a turn is running, sent once it ends */
  queue: { content: ContentBlock[]; review?: { prompt?: string } }[]
  stopped: boolean
  suspendedAt?: number
  /** picked with /model; unset = Codex's own default */
  model?: string
  effort?: string
}

export interface CodexModelOpts { model?: string; effort?: string }

/** Reasoning efforts Codex accepts for `model_reasoning_effort`. */
export const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh']
// On Windows the args go through a shell, so only plain names ever get in.
const MODEL_RE = /^[\w.:-]{1,64}$/

function modelArgs(o: CodexModelOpts): string[] {
  return [...(o.model && MODEL_RE.test(o.model) ? ['-m', o.model] : []),
    ...(o.effort && CODEX_EFFORTS.includes(o.effort) ? ['-c', `model_reasoning_effort=${o.effort}`] : [])]
}

export function codexArgs(threadId: string | null, images: string[], o: CodexModelOpts = {}): string[] {
  return ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', ...modelArgs(o),
    ...images.flatMap(p => ['-i', p]), ...(threadId ? ['resume', threadId] : []), '-']
}

/** `/review`: uncommitted changes, or custom instructions on stdin. Runs in its own thread. */
export function codexReviewArgs(prompt: string | undefined, o: CodexModelOpts = {}): string[] {
  return ['exec', 'review', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', ...modelArgs(o),
    ...(prompt?.trim() ? ['-'] : ['--uncommitted'])]
}

/** Run a short command and collect what it printed (stdout + stderr). */
function capture(cmd: string, args: string[], cwd: string, timeoutMs = 30000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    let p: ReturnType<typeof spawn>
    try { p = spawn(cmd, args, { cwd, env: process.env, windowsHide: true, shell: process.platform === 'win32' }) }
    catch (e: any) { return resolve({ code: null, out: String(e?.message ?? e) }) }
    const t = setTimeout(() => { try { p.kill() } catch { /* gone */ } }, timeoutMs)
    p.stdout?.on('data', d => { out = (out + d).slice(-200_000) })
    p.stderr?.on('data', d => { out = (out + d).slice(-200_000) })
    p.on('error', e => { clearTimeout(t); resolve({ code: null, out: out + e.message }) })
    p.on('close', code => { clearTimeout(t); resolve({ code, out }) })
  })
}

/** What Codex printed, minus its timestamped log lines. */
const tidy = (s: string) => s.split('\n').filter(l => !/^\d{4}-\d\d-\d\dT\S+\s+(ERROR|WARN|INFO)\s/.test(l)).join('\n').trim()

const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex')

/** Every saved session file (`rollout-<time>-<thread>.jsonl`) with its thread id and mtime. */
function rollouts(): { id: string; path: string; t: number }[] {
  const out: { id: string; path: string; t: number }[] = []
  const walk = (dir: string, depth: number) => {
    let names: string[]
    try { names = readdirSync(dir) } catch { return }
    for (const n of names) {
      const p = join(dir, n)
      if (depth < 3) { walk(p, depth + 1); continue }        // sessions/YYYY/MM/DD/<file>
      const m = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(n)
      if (m) try { out.push({ id: m[1], path: p, t: statSync(p).mtimeMs }) } catch { /* vanished */ }
    }
  }
  walk(join(codexHome(), 'sessions'), 0)
  return out
}

/** A Codex thread's conversation as chat transcript lines ('' when there's none). */
/**
 * Plan limits + context fill: from this thread's session file, and when it has no limits
 * reading yet (limits are per account), from the newest session files that do.
 */
export async function readCodexUsage(threadId: string | null): Promise<CodexUsage> {
  const all = rollouts().sort((a, b) => b.t - a.t)
  const own = threadId ? all.find(r => r.id.toLowerCase() === threadId.toLowerCase()) : undefined
  let usage: CodexUsage = { limits: null, contextTokens: null, contextWindow: null }
  if (own) try { usage = codexUsageFromRollout(await readFile(own.path, 'utf8')) } catch { /* unreadable */ }
  for (const r of all.slice(0, 8)) {
    if (usage.limits) break
    if (r === own) continue
    try { usage.limits = codexUsageFromRollout(await readFile(r.path, 'utf8')).limits } catch { /* unreadable */ }
  }
  return usage
}

export async function readCodexTranscript(threadId: string | null): Promise<string> {
  if (!threadId || !SESSION_ID_RE.test(threadId)) return ''
  const hit = rollouts().find(r => r.id.toLowerCase() === threadId.toLowerCase())
  if (!hit) return ''
  try { return codexRolloutToTranscript(await readFile(hit.path, 'utf8')) } catch { return '' }
}

function killTree(p: ChildProcessWithoutNullStreams) {
  if (process.platform === 'win32' && p.pid) execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], () => { /* gone */ })
  else try { p.kill() } catch { /* gone */ }
}

export class CodexChatManager {
  private chats = new Map<string, CodexChat>()
  private imgDir = join(tmpdir(), 'arw-codex-images')

  constructor(private onEvent: (id: string, event: unknown) => void, private command = process.env.ARW_CODEX || 'codex') {}

  has(id: string) { return this.chats.has(id) }

  open(id: string, cwd: string, resume?: string): { sessionId: string } {
    const cur = this.chats.get(id)
    if (cur) return { sessionId: cur.threadId ?? '' }
    const threadId = resume && SESSION_ID_RE.test(resume) ? resume : null
    this.chats.set(id, { cwd, threadId, proc: null, queue: [], stopped: false })
    return { sessionId: threadId ?? '' }
  }

  session(id: string) {
    const c = this.chats.get(id)
    return c ? { id: c.threadId ?? '', cwd: c.cwd } : undefined
  }

  send(id: string, content: ContentBlock[], echo: { text: string; images: string[] }): boolean {
    const c = this.chats.get(id)
    if (!c) return false
    this.onEvent(id, { type: 'arw_user', ...echo })
    if (c.proc) c.queue.push({ content })
    else this.run(id, c, content)
    return true
  }

  /** Show a /command and its output in every window, the way Claude's local commands appear. */
  private commandOutput(id: string, cmd: string, text: string) {
    this.onEvent(id, { type: 'user', uuid: `cx-cmd-${randomUUID()}`, message: { content: `<command-name>${cmd}</command-name>` } })
    this.onEvent(id, { type: 'user', uuid: `cx-out-${randomUUID()}`, message: { content: `<local-command-stdout>${text || '(no output)'}</local-command-stdout>` } })
  }

  /**
   * Codex slash commands that work outside its TUI: model / effort, review, diff, MCP list,
   * status, sign in / out. Output goes to the chat; the return value is for the caller.
   */
  async control(id: string, subtype: string, extra: Record<string, unknown> = {}): Promise<any> {
    const c = this.chats.get(id)
    if (!c) throw new Error('No chat for this pane')
    const bin = this.command
    switch (subtype) {
      case 'set_model': {
        const model = typeof extra.model === 'string' ? extra.model.trim() : undefined
        const effort = typeof extra.effort === 'string' ? extra.effort.trim().toLowerCase() : undefined
        if (model && model !== 'default' && !MODEL_RE.test(model)) throw new Error(`Not a model name: ${model}`)
        if (effort && effort !== 'default' && !CODEX_EFFORTS.includes(effort)) throw new Error(`Reasoning must be one of: ${CODEX_EFFORTS.join(', ')}`)
        if (model !== undefined) c.model = model && model !== 'default' ? model : undefined
        if (effort !== undefined) c.effort = effort && effort !== 'default' ? effort : undefined
        return { model: c.model ?? null, effort: c.effort ?? null }
      }
      case 'get_model': return { model: c.model ?? null, effort: c.effort ?? null }
      case 'get_usage': return readCodexUsage(c.threadId)
      case 'usage': {
        const u = await readCodexUsage(c.threadId)
        this.onEvent(id, { type: 'arw_codex_usage', ...u })
        const ctx = u.contextTokens != null
          ? `Context: ${u.contextTokens.toLocaleString()} tokens${u.contextWindow ? ` of ${u.contextWindow.toLocaleString()}` : ''}` : ''
        this.commandOutput(id, '/usage', [describeCodexLimits(u.limits), ctx].filter(Boolean).join('\n'))
        return u
      }
      case 'review': {
        const prompt = typeof extra.prompt === 'string' && extra.prompt.trim() ? extra.prompt.trim() : undefined
        this.onEvent(id, { type: 'arw_user', text: `/review${prompt ? ' ' + prompt : ''}`, images: [] })
        if (c.proc) c.queue.push({ content: [], review: { prompt } })
        else this.run(id, c, [], { prompt })
        return {}
      }
      case 'diff': {
        const diff = await capture('git', ['--no-pager', 'diff', 'HEAD', '--no-color'], c.cwd)
        const untracked = await capture('git', ['ls-files', '--others', '--exclude-standard'], c.cwd)
        let text = diff.code === 0 ? diff.out.trim() : `Not a git repository (or git failed):\n${diff.out.trim()}`
        if (untracked.code === 0 && untracked.out.trim()) text += `${text ? '\n\n' : ''}Untracked files:\n${untracked.out.trim()}`
        if (text.length > 60000) text = text.slice(0, 60000) + '\n… (diff truncated)'
        this.commandOutput(id, '/diff', text || 'No changes.')
        return {}
      }
      case 'mcp': {
        const r = await capture(bin, ['mcp', 'list'], c.cwd)
        this.commandOutput(id, '/mcp', `${tidy(r.out)}\n\nAdd one with: codex mcp add <name> -- <command>`)
        return {}
      }
      case 'status': {
        const login = await capture(bin, ['login', 'status'], c.cwd)
        const version = await capture(bin, ['--version'], c.cwd)
        const usage = await readCodexUsage(c.threadId)
        this.commandOutput(id, '/status', [
          `Version:    ${tidy(version.out)}`,
          `Account:    ${tidy(login.out)}`,
          `Model:      ${c.model ?? 'default (from ~/.codex/config.toml)'}`,
          `Reasoning:  ${c.effort ?? 'default'}`,
          `Folder:     ${c.cwd}`,
          `Thread:     ${c.threadId ?? '(new — starts with your next message)'}`,
          'Sandbox:    off (approvals and sandbox bypassed)',
          '',
          describeCodexLimits(usage.limits)
        ].join('\n'))
        return {}
      }
      case 'logout': {
        const r = await capture(bin, ['logout'], c.cwd)
        this.commandOutput(id, '/logout', tidy(r.out))
        return {}
      }
      case 'login': {
        // Opens the browser and waits for the sign-in to finish (up to 5 minutes).
        this.onEvent(id, { type: 'arw_notice', tone: 'info', text: 'Opening your browser to sign in to Codex… finish there, then come back here.' })
        const r = await capture(bin, ['login'], c.cwd, 5 * 60_000)
        const status = await capture(bin, ['login', 'status'], c.cwd)
        this.commandOutput(id, '/login', `${tidy(r.out)}\n\n${tidy(status.out)}`.trim())
        return {}
      }
    }
    throw new Error(`/${subtype} isn't available in the Codex chat`)
  }

  private run(id: string, c: CodexChat, content: ContentBlock[], review?: { prompt?: string }) {
    const text = content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
    const images: string[] = []
    for (const b of content) {
      if (b.type !== 'image') continue
      try {
        mkdirSync(this.imgDir, { recursive: true })
        const ext = (b.source.media_type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '')
        const p = join(this.imgDir, `${randomUUID()}.${ext}`)
        writeFileSync(p, Buffer.from(b.source.data, 'base64'))
        images.push(p)
      } catch { /* skip the image */ }
    }
    const turn = newCodexTurn()
    c.stopped = false
    // `codex` is an npm .cmd shim on Windows, which only a shell can start. Every argument
    // is a flag, a uuid or a temp path without spaces; the prompt goes through stdin.
    const opts = { model: c.model, effort: c.effort }
    const proc = spawn(this.command, review ? codexReviewArgs(review.prompt, opts) : codexArgs(c.threadId, images, opts), {
      cwd: c.cwd, env: process.env, windowsHide: true, shell: process.platform === 'win32'
    }) as ChildProcessWithoutNullStreams
    c.proc = proc
    let buf = '', stderr = '', ended = false
    const emit = (ev: any) => {
      if (ev?.type === 'result') ended = true
      this.onEvent(id, ev)
    }
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('{')) continue
        let ev: any
        try { ev = JSON.parse(line) } catch { continue }
        if (ev?.type === 'thread.started') {
          if (review) continue                     // a review runs in its own thread; keep the chat's
          if (SESSION_ID_RE.test(ev.thread_id ?? '')) c.threadId = ev.thread_id
        }
        for (const out of codexToChat(ev, turn)) emit(out)
      }
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => { stderr = (stderr + d).slice(-4000) })
    proc.stdin.on('error', () => { /* process died before reading the prompt */ })
    proc.stdin.end(review ? (review.prompt ?? '') : text)

    let finished = false
    const done = (code: number | null, err?: Error) => {
      if (finished) return
      finished = true
      if (c.proc === proc) c.proc = null
      for (const p of images) rmSync(p, { force: true })
      if (!ended) {
        const tail = stderr.trim().split('\n').filter(Boolean).slice(-4).join('\n')
        if (c.stopped) emit({ type: 'result', subtype: 'error_during_execution', duration_ms: Date.now() - turn.startedAt })
        else if (err) emit({ type: 'arw_exit', code: null, text: `Couldn't start Codex (${err.message}). Is \`codex\` installed? Run: npm i -g @openai/codex` })
        else if (turn.lastError) emit({ type: 'arw_exit', code, text: turn.lastError })
        else if (/not logged in|login|unauthorized|401/i.test(tail)) emit({ type: 'arw_exit', code, text: `Codex isn't signed in. Open a Codex terminal and run \`codex login\`, then try again.\n${tail}` })
        else emit({ type: 'arw_exit', code, text: `Codex exited${code ? ` (code ${code})` : ''}. ${tail}` })
      }
      // Codex writes the turn's token_count (limits, context) to the session file; show it.
      void readCodexUsage(c.threadId).then(u => { if (this.chats.get(id) === c) this.onEvent(id, { type: 'arw_codex_usage', ...u }) })
      const next = c.queue.shift()
      if (next && this.chats.get(id) === c && !c.stopped) this.run(id, c, next.content, next.review)
      else c.queue = []
    }
    proc.on('error', (e) => done(null, e))
    proc.on('close', (code) => done(code))
  }

  interrupt(id: string): void {
    const c = this.chats.get(id)
    if (!c?.proc) return
    c.stopped = true
    c.queue = []
    killTree(c.proc)
  }

  reset(id: string): { sessionId: string } | null {
    const c = this.chats.get(id)
    if (!c) return null
    this.interrupt(id)
    c.threadId = null
    return { sessionId: '' }
  }

  /** Hand the conversation to an interactive `codex` terminal (`codex resume <thread>`). */
  suspend(id: string): { sessionId: string; resume: boolean } | null {
    const c = this.chats.get(id)
    if (!c) return null
    this.interrupt(id)
    c.suspendedAt = Date.now()
    return { sessionId: c.threadId ?? '', resume: !!c.threadId }
  }

  /** Back from the terminal: follow whichever Codex session it wrote to last. */
  resumeAfterTerminal(id: string): { sessionId: string; cwd: string } | null {
    const c = this.chats.get(id)
    if (!c) return null
    if (c.suspendedAt) {
      const since = c.suspendedAt - 2000
      const newest = rollouts().filter(r => r.t >= since).sort((a, b) => b.t - a.t)[0]
      if (newest) c.threadId = newest.id
    }
    c.suspendedAt = undefined
    return { sessionId: c.threadId ?? '', cwd: c.cwd }
  }

  kill(id: string): void {
    const c = this.chats.get(id)
    if (!c) return
    this.interrupt(id)
    this.chats.delete(id)
  }

  killAll(): void { for (const id of [...this.chats.keys()]) this.kill(id) }
}
