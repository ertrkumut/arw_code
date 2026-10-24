import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import { ENV_TERMINAL_ID, ENV_EVENT_URL } from '@shared/constants'
import { resolveAgent } from '@shared/agents'
import { ensureUnityMcp } from './unityMcp'
import { SESSION_ID_RE } from './claudeHistory'

export interface SpawnOpts {
  id: string; cwd: string; eventUrl: string; cols: number; rows: number
  /** Which CLI to launch. Omitted / unknown falls back to Claude. */
  agent?: string
  /** Claude session id to continue (`--resume <id>`). Ignored for other agents. */
  resume?: string
}

type DataCb = (id: string, data: string) => void
type ExitCb = (id: string, code: number) => void

export class PtyManager {
  private procs = new Map<string, pty.IPty>()
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
        env: { ...process.env, [ENV_TERMINAL_ID]: opts.id, [ENV_EVENT_URL]: opts.eventUrl }
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
    // Only a well-formed uuid is ever appended — this string is typed into a shell.
    const resume = def.id === 'claude' && opts.resume && SESSION_ID_RE.test(opts.resume)
      ? ` --resume ${opts.resume}` : ''
    p.write(def.command + resume + '\r')
  }

  write(id: string, data: string) { this.procs.get(id)?.write(data) }
  resize(id: string, cols: number, rows: number) { this.procs.get(id)?.resize(cols, rows) }
  kill(id: string) { this.procs.get(id)?.kill(); this.procs.delete(id) }
  killAll() { for (const p of this.procs.values()) p.kill(); this.procs.clear() }
}
