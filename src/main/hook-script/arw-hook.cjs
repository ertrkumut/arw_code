#!/usr/bin/env node
const http = require('http')
const url = process.env.ARW_EVENT_URL
const id = process.env.ARW_TERMINAL_ID
const hookEvent = process.env.CLAUDE_HOOK_EVENT || process.argv[2] || ''
const MAP = { PreToolUse: 'working', UserPromptSubmit: 'working', Notification: 'needs-you', Stop: 'idle' }
const state = MAP[hookEvent]
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
