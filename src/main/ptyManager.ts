import { claudeEnv } from './cleanEnv'
import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import { ENV_TERMINAL_ID, ENV_EVENT_URL, CLAUDE_MODEL } from '@shared/constants'
import { resolveAgent } from '@shared/agents'
import { ensureUnityMcp } from './unityMcp'
import { SESSION_ID_RE } from './claudeHistory'
import { randomUUID } from 'node:crypto'

export interface SpawnOpts {
  id: string; cwd: string; eventUrl: string; cols: number; rows: number
  /** Which CLI to launch. Omitted / unknown falls back to Claude. */
  agent?: string
  /** Claude session id to continue (`--resume <id>`). Ignored for other agents. */
  resume?: string
  /** Claude: start a *new* session with this exact id (`--session-id`). Ignored when resuming. */
  sessionId?: string
  /** Close the shell when the agent exits (a chat pane's terminal mode returns to the chat then). */
  exitWithAgent?: boolean
}

type DataCb = (id: string, data: string) => void
type ExitCb = (id: string, code: number) => void

export class PtyManager {
  private procs = new Map<string, pty.IPty>()
  private sessions = new Map<string, { id: string; cwd: string }>()
  constructor(
    private onData: DataCb,
    private onExit: ExitCb,
    private onError?: (id: string, message: string) => void
  ) {}

  spawn(opts: SpawnOpts) {
    // Idempotent: a terminal id already has a live shell when its view is
    // re-mounted in another window (tear-off / reattach) or after a project
    // switch. Don't respawn — just resize the existing pty to the new view.
    if (this.procs.has(opts.id)) { this.resize(opts.id, opts.cols, opts.rows); return }
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash')
    let p: pty.IPty
    try {
      p = pty.spawn(shell, [], {
        name: 'xterm-color', cwd: opts.cwd, cols: opts.cols, rows: opts.rows,
        env: claudeEnv(process.env, { [ENV_TERMINAL_ID]: opts.id, [ENV_EVENT_URL]: opts.eventUrl }) as { [key: string]: string }
      })
    } catch (err) {
      this.onError?.(opts.id, String(err))
      return
    }
    // Status (working / needs-you / idle) is driven exclusively by Claude's
    // lifecycle hooks via the StatusBridge — never inferred from raw pty output.
    // Terminal bytes are a poor proxy for "Claude is working" (shell prompts and
    // the claude startup banner would flash the dot green), and an output-silence
    // timer would erase a real `needs-you` while Claude waits for the user.
    p.onData((d) => this.onData(opts.id, d))
    p.onExit(({ exitCode }) => { this.procs.delete(opts.id); this.onExit(opts.id, exitCode) })
    this.procs.set(opts.id, p)
    const def = resolveAgent(opts.agent)
    let args = ''
    if (def.id === 'claude') {
      // Pin the session id up front (or reuse the resumed one) so this terminal's
      // transcript — and the images sent in it — can be found later. Only a
      // well-formed uuid is ever appended: this string is typed into a shell.
      const resume = opts.resume && SESSION_ID_RE.test(opts.resume) ? opts.resume : null
      const pinned = opts.sessionId && SESSION_ID_RE.test(opts.sessionId) ? opts.sessionId : null
      const sid = resume ?? pinned ?? randomUUID()
      this.sessions.set(opts.id, { id: sid, cwd: opts.cwd })
      args = (resume ? ` --resume ${sid}` : ` --session-id ${sid}`) + ` --model ${CLAUDE_MODEL}`
    }
    p.write(def.command + args + (opts.exitWithAgent ? exitAfterAgent() : '') + '\r')
  }

  /** The Claude session a terminal was launched with (undefined for other agents). */
  claudeSession(id: string) { return this.sessions.get(id) }

  write(id: string, data: string) { this.procs.get(id)?.write(data) }
  resize(id: string, cols: number, rows: number) { this.procs.get(id)?.resize(cols, rows) }
  kill(id: string) {
    // A pty whose process already ended can throw on kill (Windows ConPTY).
    try { this.procs.get(id)?.kill() } catch { /* already gone */ }
    this.procs.delete(id); this.sessions.delete(id)
  }
  killAll() { for (const p of this.procs.values()) p.kill(); this.procs.clear(); this.sessions.clear() }
}

/**
 * Printed when the agent exits in a chat pane's terminal mode, so the renderer knows to go
 * back to the chat even when the pty's own exit event doesn't arrive (ConPTY can lose it).
 * The echoed command line splits the word in two, so only the real output matches.
 */
export const TUI_DONE_MARKER = '__ARW_TUI_DONE__'
export function exitAfterAgent(platform = process.platform): string {
  return platform === 'win32' ? "; echo ('__ARW_' + 'TUI_DONE__'); exit" : "; echo '__ARW_''TUI_DONE__'; exit"
}
