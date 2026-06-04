import { createServer, Server } from 'http'
import type { HookEvent } from '@shared/types'

export class StatusBridge {
  private server: Server | null = null
  private port = 0
  constructor(private onEvent: (e: HookEvent) => void) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c) => (body += c))
          req.on('end', () => {
            try { this.onEvent(JSON.parse(body)) } catch { /* ignore malformed */ }
            res.writeHead(204); res.end()
          })
        } else { res.writeHead(404); res.end() }
      })
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as { port: number }).port
        resolve()
      })
    })
  }

  url() { return `http://127.0.0.1:${this.port}/event` }
  stop() { this.server?.close(); this.server = null }
}
