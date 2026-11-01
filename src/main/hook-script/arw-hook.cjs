#!/usr/bin/env node
const http = require('http')
const url = process.env.ARW_EVENT_URL
const id = process.env.ARW_TERMINAL_ID
// MAP is intentionally duplicated from src/shared/status.ts HOOK_MAP — this .cjs cannot import TS modules.
const MAP = { PreToolUse: 'working', UserPromptSubmit: 'working', Notification: 'needs-you', Stop: 'idle' }

function post(state, sessionId) {
  if (!url || !id || (!state && !sessionId)) process.exit(0)
  // sessionId tells ARWCode which conversation this terminal is on (it changes on /resume).
  const body = JSON.stringify({ id, state: state || undefined, sessionId: sessionId || undefined })
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
  let evt = '', sid = ''
  try { const j = JSON.parse(raw); evt = j.hook_event_name || ''; sid = j.session_id || '' } catch { /* ignore */ }
  if (!evt) evt = process.env.CLAUDE_HOOK_EVENT || process.argv[2] || ''
  post(MAP[evt], sid)
})
// Safety: if stdin never ends (no data piped), exit after a short grace period.
setTimeout(() => process.exit(0), 1500)
