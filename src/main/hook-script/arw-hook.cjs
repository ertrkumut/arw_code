#!/usr/bin/env node
const http = require('http')
const url = process.env.ARW_EVENT_URL
const id = process.env.ARW_TERMINAL_ID
// MAP is intentionally duplicated from src/shared/status.ts HOOK_MAP — this .cjs cannot import TS modules.
const MAP = { PreToolUse: 'working', UserPromptSubmit: 'working', Notification: 'needs-you', Stop: 'idle' }

function post(state) {
  if (!url || !id || !state) process.exit(0)
  const body = JSON.stringify({ id, state })
  const u = new URL(url)
  const req = http.request(
    { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
    () => process.exit(0)
  )
  req.on('error', () => process.exit(0))
  req.write(body); req.end()
}

let raw = ''
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let evt = ''
  try { evt = JSON.parse(raw).hook_event_name || '' } catch { /* ignore */ }
  if (!evt) evt = process.env.CLAUDE_HOOK_EVENT || process.argv[2] || ''
  post(MAP[evt])
})
// Safety: if stdin never ends (no data piped), exit after a short grace period.
setTimeout(() => process.exit(0), 1500)
