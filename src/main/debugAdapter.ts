import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Debug Adapter Protocol client for the Unity (Mono soft-debugger) adapter.
 *
 * The adapter is DotRush's `monodbg` (MIT, github.com/JaneySprings/DotRush). It is built
 * on Mono.Debugging.Soft — the same engine Rider's Unity debugger uses — and finds the
 * running Unity Editor from `<project>/Library/EditorInstance.json`.
 */

export interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  event?: string
  request_seq?: number
  success?: boolean
  message?: string
  body?: any
  arguments?: any
}

/** Incremental `Content-Length` frame parser for DAP over stdio. */
export class DapFramer {
  private buf = Buffer.alloc(0)
  constructor(private onMessage: (m: DapMessage) => void) {}

  push(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk])
    for (;;) {
      const headerEnd = this.buf.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buf.subarray(0, headerEnd).toString('ascii')
      const m = /Content-Length:\s*(\d+)/i.exec(header)
      if (!m) { this.buf = this.buf.subarray(headerEnd + 4); continue }   // junk header — skip it
      const len = Number(m[1])
      const start = headerEnd + 4
      if (this.buf.length < start + len) return
      const body = this.buf.subarray(start, start + len).toString('utf8')
      this.buf = this.buf.subarray(start + len)
      try { this.onMessage(JSON.parse(body)) } catch { /* malformed frame — ignore */ }
    }
  }
}

export function encodeDap(msg: object): Buffer {
  const json = Buffer.from(JSON.stringify(msg), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii'), json])
}

/** Compare dotted version strings like "25.12.355". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Editor extension folders that may hold a DotRush install. */
export function extensionRoots(home = homedir()): string[] {
  return ['.vscode', '.vscode-insiders', '.antigravity', '.cursor', '.windsurf', '.vscode-oss']
    .map(d => join(home, d, 'extensions'))
}

/**
 * Locate the monodbg adapter: $ARW_MONODBG, then the newest DotRush extension in any
 * VS Code-family editor. Returns null when none is installed.
 */
export function findMonoDbg(roots = extensionRoots(), env = process.env): string | null {
  const exe = process.platform === 'win32' ? 'monodbg.exe' : 'monodbg'
  if (env.ARW_MONODBG && existsSync(env.ARW_MONODBG)) return env.ARW_MONODBG
  let best: { v: string; path: string } | null = null
  for (const root of roots) {
    let names: string[]
    try { names = readdirSync(root) } catch { continue }
    for (const n of names) {
      const m = /^nromanov\.dotrush-(\d+(?:\.\d+)*)/.exec(n)
      if (!m) continue
      const p = join(root, n, 'extension', 'bin', 'DebuggerMono', exe)
      if (existsSync(p) && (!best || compareVersions(m[1], best.v) > 0)) best = { v: m[1], path: p }
    }
  }
  return best?.path ?? null
}

/** One adapter process + request/response bookkeeping. */
export class DapSession {
  private proc: ChildProcessWithoutNullStreams
  private seq = 1
  private pending = new Map<number, { resolve: (b: any) => void; reject: (e: Error) => void }>()
  private closed = false

  constructor(
    adapterPath: string,
    private onEvent: (event: string, body: any) => void,
    private onExit: (code: number | null, stderr: string) => void
  ) {
    let stderr = ''
    this.proc = spawn(adapterPath, [], { stdio: 'pipe', windowsHide: true })
    const framer = new DapFramer(m => this.handle(m))
    this.proc.stdout.on('data', (c: Buffer) => framer.push(c))
    this.proc.stderr.on('data', (c: Buffer) => { stderr = (stderr + c.toString()).slice(-4000) })
    this.proc.on('error', (e) => { stderr += String(e); this.finish(null, stderr) })
    this.proc.on('exit', (code) => this.finish(code, stderr))
  }

  private finish(code: number | null, stderr: string) {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) p.reject(new Error('Debug adapter exited'))
    this.pending.clear()
    this.onExit(code, stderr)
  }

  private handle(m: DapMessage) {
    if (m.type === 'response' && m.request_seq != null) {
      const p = this.pending.get(m.request_seq)
      if (!p) return
      this.pending.delete(m.request_seq)
      if (m.success) p.resolve(m.body ?? {})
      else p.reject(new Error(m.message || m.body?.error?.format || `${m.command} failed`))
    } else if (m.type === 'event' && m.event) {
      this.onEvent(m.event, m.body ?? {})
    } else if (m.type === 'request') {
      // Reverse requests (runInTerminal etc.) aren't supported — answer so the adapter doesn't hang.
      this.write({ seq: this.seq++, type: 'response', request_seq: m.seq, command: m.command, success: false, message: 'not supported' })
    }
  }

  private write(msg: object) {
    if (!this.closed) this.proc.stdin.write(encodeDap(msg))
  }

  request(command: string, args?: unknown, timeoutMs = 30000): Promise<any> {
    if (this.closed) return Promise.reject(new Error('Debug adapter is not running'))
    const seq = this.seq++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(seq)) reject(new Error(`${command} timed out`))
      }, timeoutMs)
      this.pending.set(seq, {
        resolve: (b) => { clearTimeout(timer); resolve(b) },
        reject: (e) => { clearTimeout(timer); reject(e) }
      })
      this.write({ seq, type: 'request', command, arguments: args })
    })
  }

  get running() { return !this.closed }

  kill() {
    if (!this.closed) { try { this.proc.kill() } catch { /* already gone */ } }
  }
}
