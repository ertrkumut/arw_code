import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import { ENV_TERMINAL_ID, ENV_EVENT_URL } from '@shared/constants'

export interface SpawnOpts { id: string; cwd: string; eventUrl: string; cols: number; rows: number }

type DataCb = (id: string, data: string) => void
type ExitCb = (id: string, code: number) => void

export class PtyManager {
  private procs = new Map<string, pty.IPty>()
  constructor(private onData: DataCb, private onExit: ExitCb) {}

  spawn(opts: SpawnOpts) {
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash')
    const p = pty.spawn(shell, [], {
      name: 'xterm-color',
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: { ...process.env, [ENV_TERMINAL_ID]: opts.id, [ENV_EVENT_URL]: opts.eventUrl }
    })
    p.onData((d) => this.onData(opts.id, d))
    p.onExit(({ exitCode }) => { this.procs.delete(opts.id); this.onExit(opts.id, exitCode) })
    this.procs.set(opts.id, p)
    p.write('claude\r')
  }

  write(id: string, data: string) { this.procs.get(id)?.write(data) }
  resize(id: string, cols: number, rows: number) { this.procs.get(id)?.resize(cols, rows) }
  kill(id: string) { this.procs.get(id)?.kill(); this.procs.delete(id) }
  killAll() { for (const p of this.procs.values()) p.kill(); this.procs.clear() }
}
