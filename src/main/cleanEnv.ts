/**
 * Environment for the Claude processes ARWCode starts.
 *
 * When ARWCode itself was launched from inside a Claude Code session (e.g. `npm run dev` run
 * by Claude), it inherits that session's markers. A `claude` that sees them believes it is a
 * child of that session: it turns transcript saving off ("inherited CLAUDE_CODE_CHILD_SESSION
 * marker"), so conversations can't be resumed and the chat history disappears. Strip them so
 * every pane is a normal, top-level Claude session. User config (ANTHROPIC_BASE_URL, API
 * keys, CLAUDE_CONFIG_DIR) is kept.
 */
const SESSION_MARKERS = [
  'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT', 'CLAUDE_PID', 'CLAUDE_EFFORT'
]

export function claudeEnv(base: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const k of Object.keys(env)) if (SESSION_MARKERS.includes(k.toUpperCase())) delete env[k]
  return { ...env, ...extra }
}
