import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import { ENV_TERMINAL_ID, ENV_EVENT_URL, IDLE_FALLBACK_MS } from '@shared/constants'
import { TermState } from '@shared/types'

export interface SpawnOpts { id: string; cwd: string; eventUrl: string; cols: number; rows: number }

type DataCb = (id: string, data: string) => void
type ExitCb = (id: string, code: number) => void

export class PtyManager {
  private procs = new Map<string, pty.IPty>()
  constructor(
    private onData: DataCb,
    private onExit: ExitCb,
    private onInferred?: (id: string, state: TermState) => void,
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
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    p.onData((d) => {
      this.onData(opts.id, d)
      this.onInferred?.(opts.id, 'working')
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => this.onInferred?.(opts.id, 'idle'), IDLE_FALLBACK_MS)
    })
    p.onExit(({ exitCode }) => { if (idleTimer) clearTimeout(idleTimer); this.procs.delete(opts.id); this.onExit(opts.id, exitCode) })
    this.procs.set(opts.id, p)
    p.write('claude --dangerously-skip-permissions\r')
  }

  write(id: string, data: string) { this.procs.get(id)?.write(data) }
  resize(id: string, cols: number, rows: number) { this.procs.get(id)?.resize(cols, rows) }
  kill(id: string) { this.procs.get(id)?.kill(); this.procs.delete(id) }
  killAll() { for (const p of this.procs.values()) p.kill(); this.procs.clear() }
}
