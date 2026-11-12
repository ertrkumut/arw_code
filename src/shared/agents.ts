/** The CLIs ARWCode knows how to launch inside a terminal. */
export type AgentId = 'claude' | 'codex' | 'gemini' | 'kimi' | 'unity'

export interface AgentDef {
  id: AgentId
  /** Shown in the picker and the "New terminal" button. */
  label: string
  /** Written into the freshly spawned shell to start the CLI. */
  command: string
  /** Two-letter badge rendered in the pane header. */
  badge: string
  /** Brand tint for the badge + picker row. */
  color: string
  /**
   * Whether the agent reports working / needs-you / idle through ARWCode's hook
   * bridge. Only Claude Code has a hooks API we can install into, so every other
   * agent's status dot stays neutral instead of lying about what the CLI is doing.
   */
  hasStatusHooks: boolean
  /**
   * Whether the CLI discovers project-scoped MCP servers from a `.mcp.json` at its
   * working directory. Only Claude Code does; the others read a single user-level
   * config (`~/.codex/config.toml`, `~/.kimi/mcp.json`, ...) that ARWCode has no
   * business rewriting per project. Gates the Unity Editor bridge in unityMcp.ts.
   */
  readsProjectMcp: boolean
}

export const DEFAULT_AGENT: AgentId = 'claude'

/**
 * Single place to change how each CLI is invoked. Every *agent* is launched in
 * "don't stop to ask" mode, matching how ARWCode is meant to be driven — edit the
 * `command` here if you want a different flag set (or a different binary name).
 */
export const AGENTS: Record<AgentId, AgentDef> = {
  claude: {
    id: 'claude', label: 'Claude Code', badge: 'CC', color: '#D97757',
    command: 'claude --dangerously-skip-permissions', hasStatusHooks: true, readsProjectMcp: true
  },
  /**
   * OpenAI ships no CLI under the "ChatGPT" name — Codex CLI (`npm i -g
   * @openai/codex`) is the ChatGPT-account-backed agent, so that's what this row
   * launches. The long bypass flag is the documented one; `--yolo` is a newer
   * alias that older installs won't have.
   */
  codex: {
    id: 'codex', label: 'Codex CLI', badge: 'CX', color: '#10A37F',
    command: 'codex --dangerously-bypass-approvals-and-sandbox', hasStatusHooks: false, readsProjectMcp: false
  },
  gemini: {
    id: 'gemini', label: 'Gemini CLI', badge: 'GM', color: '#5B8DEF',
    command: 'gemini --yolo', hasStatusHooks: false, readsProjectMcp: false
  },
  kimi: {
    id: 'kimi', label: 'Kimi CLI', badge: 'KI', color: '#8B7CF6',
    command: 'kimi', hasStatusHooks: false, readsProjectMcp: false
  },
  /**
   * The odd one out: Unity's CLI is a tool, not a conversational agent. `unity shell`
   * is a REPL for Unity's own commands (install / editors / open / test / run), so a
   * Unity pane is a console you type at, not an agent you brief. It sits here because
   * a Unity pane next to the agent panes is genuinely useful, not because it's an AI.
   *
   * The grey badge is deliberate — the four saturated brand tints mean "AI agent", and
   * Unity's monochrome mark reading differently is the point.
   *
   * Its Editor-driving MCP server is a separate concern entirely: see unityMcp.ts,
   * which hands `unity mcp` to the *Claude* panes rather than launching anything here.
   */
  unity: {
    id: 'unity', label: 'Unity CLI', badge: 'UN', color: '#A7B6C2',
    command: 'unity shell', hasStatusHooks: false, readsProjectMcp: false
  }
}

/** Display order for the picker. */
export const AGENT_LIST: AgentDef[] = [AGENTS.claude, AGENTS.codex, AGENTS.gemini, AGENTS.kimi, AGENTS.unity]

/**
 * Unknown / missing ids resolve to Claude, so terminals persisted before agent
 * selection existed keep launching exactly what they always did.
 */
export function resolveAgent(id?: string | null): AgentDef {
  return (id != null && AGENTS[id as AgentId]) || AGENTS[DEFAULT_AGENT]
}

/** Claude and Codex panes are chats; every other agent is a real terminal. */
export const isChatAgent = (agent?: AgentId | null) => (agent ?? DEFAULT_AGENT) === 'claude' || agent === 'codex'

/** Narrow an arbitrary persisted value back to a known agent id. */
export function toAgentId(v: unknown): AgentId {
  return typeof v === 'string' && v in AGENTS ? (v as AgentId) : DEFAULT_AGENT
}
