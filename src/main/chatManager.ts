import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { ENV_TERMINAL_ID, ENV_EVENT_URL } from '@shared/constants'
import { SESSION_ID_RE, claudeProjectDir } from './claudeHistory'
import { claudeEnv } from './cleanEnv'

/**
 * One headless Claude Code process per chat pane.
 *
 *   claude -p --input-format stream-json --output-format stream-json --verbose
 *          --include-partial-messages --dangerously-skip-permissions
 *          (--session-id <new> | --resume <id>)
 *
 * The process stays alive across turns: each prompt is one JSON line on stdin, and every
 * event Claude prints is forwarded to the renderer. If it exits, the next prompt starts a
 * new process with --resume, so the conversation carries on.
 */

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

interface Chat {
  proc: ChildProcessWithoutNullStreams | null
  sessionId: string
  cwd: string
  stderr: string
  /** when the pane switched to terminal mode */
  suspendedAt?: number
}

export function claudeArgs(sessionId: string, resume: boolean, extra: string[] = []): string[] {
  return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--dangerously-skip-permissions',
    ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]), ...extra]
}

/** One stdin line for a prompt. */
export function userLine(content: ContentBlock[]): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n'
}

/**
 * Whether Claude has saved this session yet. Claude writes the transcript only once a message
 * is sent, so a pinned-but-unused id must start with --session-id, never --resume
 * ("No conversation found with session ID").
 */
export function sessionExists(cwd: string, sessionId: string, home?: string): boolean {
  return SESSION_ID_RE.test(sessionId) && existsSync(join(claudeProjectDir(cwd, home), `${sessionId}.jsonl`))
}

/** Last session each terminal reported through Claude's hooks (terminal id -> session id). */
const reported = new Map<string, string>()
export function noteSession(termId: string, sessionId: string) { if (SESSION_ID_RE.test(sessionId)) reported.set(termId, sessionId) }
export function takeReportedSession(termId: string) { const s = reported.get(termId); reported.delete(termId); return s }

/**
 * Fallback when no hook reported: the conversation the terminal touched last, i.e. the
 * newest transcript in the project written since terminal mode began.
 */
export function newestSessionSince(cwd: string, since: number, home?: string): string | undefined {
  const { readdirSync, statSync } = require('fs') as typeof import('fs')
  const dir = claudeProjectDir(cwd, home)
  let best: { id: string; t: number } | undefined
  try {
    for (const n of readdirSync(dir)) {
      const id = n.replace(/\.jsonl$/, '')
      if (id === n || !SESSION_ID_RE.test(id)) continue
      const t = statSync(join(dir, n)).mtimeMs
      if (t >= since && (!best || t > best.t)) best = { id, t }
    }
  } catch { /* no history dir */ }
  return best?.id
}

export class ChatManager {
  private chats = new Map<string, Chat>()

  constructor(
    private onEvent: (id: string, event: unknown) => void,
    private eventUrl: () => string,
    private command = process.env.ARW_CLAUDE || 'claude'
  ) {}

  /**
   * Register a pane's conversation (no process yet — it starts on the first prompt).
   * `resume` continues an existing session; otherwise a fresh id is pinned up front.
   */
  open(id: string, cwd: string, resume?: string): { sessionId: string } {
    const cur = this.chats.get(id)
    if (cur) return { sessionId: cur.sessionId }
    const valid = resume && SESSION_ID_RE.test(resume) ? resume : null
    const chat: Chat = { proc: null, sessionId: valid ?? randomUUID(), cwd, stderr: '' }
    this.chats.set(id, chat)
    return { sessionId: chat.sessionId }
  }

  session(id: string) {
    const c = this.chats.get(id)
    return c ? { id: c.sessionId, cwd: c.cwd } : undefined
  }

  private ensureProc(id: string, c: Chat): ChildProcessWithoutNullStreams {
    if (c.proc) return c.proc
    const proc = spawn(this.command, claudeArgs(c.sessionId, sessionExists(c.cwd, c.sessionId)), {
      cwd: c.cwd,
      env: claudeEnv(process.env, { [ENV_TERMINAL_ID]: id, [ENV_EVENT_URL]: this.eventUrl() }),
      windowsHide: true
    })
    c.proc = proc
    c.stderr = ''
    let buf = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let ev: any
        try { ev = JSON.parse(line) } catch { continue }
        // A resumed session can come back under a new id — follow it.
        if (ev?.type === 'system' && ev.subtype === 'init' && SESSION_ID_RE.test(ev.session_id ?? '')) c.sessionId = ev.session_id
        this.onEvent(id, ev)
      }
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => { c.stderr = (c.stderr + d).slice(-4000) })
    const done = (code: number | null, err?: Error) => {
      if (c.proc !== proc) return
      c.proc = null
      const text = err ? `Couldn't start Claude Code (${err.message}). Is \`claude\` installed and on PATH?`
        : code ? `Claude exited (code ${code}). ${c.stderr.trim().split('\n').slice(-3).join(' ')}` : ''
      this.onEvent(id, { type: 'arw_exit', code, text })
    }
    proc.on('error', (err) => done(null, err))
    proc.on('exit', (code) => done(code))
    return proc
  }

  /** Send a prompt. Echoed to every window first so all views show it. */
  send(id: string, content: ContentBlock[], echo: { text: string; images: string[] }): boolean {
    const c = this.chats.get(id)
    if (!c) return false
    this.onEvent(id, { type: 'arw_user', ...echo })
    const proc = this.ensureProc(id, c)
    proc.stdin.write(userLine(content))
    return true
  }

  /** Stop the current turn (Claude keeps the conversation). */
  interrupt(id: string): void {
    const proc = this.chats.get(id)?.proc
    if (!proc) return
    proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } }) + '\n')
  }

  /** Start over with a fresh session (like /clear). */
  reset(id: string): { sessionId: string } | null {
    const c = this.chats.get(id)
    if (!c) return null
    this.stopProc(c)
    c.sessionId = randomUUID()
    return { sessionId: c.sessionId }
  }

  private stopProc(c: Chat) {
    const p = c.proc
    if (!p) return
    c.proc = null
    try { p.stdin.end() } catch { /* closed */ }
    setTimeout(() => { try { p.kill() } catch { /* gone */ } }, 1500)
  }

  /**
   * Hand the conversation to an interactive `claude` terminal: stop the headless process
   * (two writers on one session would corrupt it). Returns how the terminal should start.
   */
  suspend(id: string): { sessionId: string; resume: boolean } | null {
    const c = this.chats.get(id)
    if (!c) return null
    this.stopProc(c)
    c.suspendedAt = Date.now()
    return { sessionId: c.sessionId, resume: sessionExists(c.cwd, c.sessionId) }
  }

  /** Back from the terminal: the session now exists on disk, so the next prompt resumes it. */
  resumeAfterTerminal(id: string, sessionId?: string): { sessionId: string; cwd: string } | null {
    const c = this.chats.get(id)
    if (!c) return null
    // Follow the terminal: /resume or /clear there moves it to another conversation.
    const next = (sessionId && SESSION_ID_RE.test(sessionId) ? sessionId : undefined)
      ?? (c.suspendedAt ? newestSessionSince(c.cwd, c.suspendedAt - 2000) : undefined)
    if (next) c.sessionId = next
    c.suspendedAt = undefined
    return { sessionId: c.sessionId, cwd: c.cwd }
  }

  kill(id: string): void {
    const c = this.chats.get(id)
    if (!c) return
    this.stopProc(c)
    this.chats.delete(id)
  }

  killAll(): void { for (const id of [...this.chats.keys()]) this.kill(id) }
}

/** A session's transcript text (for showing the conversation so far). Missing → ''. */
export async function readTranscript(projectPath: string, sessionId: string): Promise<string> {
  if (!SESSION_ID_RE.test(sessionId)) return ''
  try { return await readFile(join(claudeProjectDir(projectPath), `${sessionId}.jsonl`), 'utf8') } catch { return '' }
}
