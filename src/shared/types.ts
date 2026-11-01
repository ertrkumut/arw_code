import type { AgentId } from './agents'

export type TermState = 'working' | 'needs-you' | 'idle' | 'error'

/** How a project's terminals tile. vertical = stacked (one column),
 *  horizontal = side-by-side (one row), grid = auto square-ish tiling. */
export type LayoutMode = 'grid' | 'vertical' | 'horizontal'

export interface Terminal {
  id: string
  name: string
  order: number
  /** Preset hex used to tint the pane header + focus accent. Undefined = default teal. Persisted. */
  color?: string
  /** Transient: true while the terminal lives in a torn-off window. Never persisted. */
  detached?: boolean
  /** Which CLI this terminal launched. Undefined = 'claude' (pre-agent-picker terminals). Persisted. */
  agent?: AgentId
  /** True while the name follows the title the CLI sets; false once the user renames it.
   *  Undefined (older terminals) = auto only if still on the default "terminal N". Persisted. */
  autoName?: boolean
  /** Claude chat panes: the conversation's session id, so it reopens where it left off. Persisted. */
  sessionId?: string
}

export interface Group {
  id: string
  name: string
  collapsed: boolean
  /** Preset hex tinting the group header stripe/background. Undefined = neutral. Persisted. */
  color?: string
}

export interface Project {
  id: string
  name: string
  path: string
  collapsed: boolean
  terminals: Terminal[]
  groupId: string | null   // null = Ungrouped section
  /** Preset hex tinting the project card stripe/background. Undefined = neutral. Persisted. */
  color?: string
  /** How this project's terminals tile. Undefined = 'grid' (backward compatible). Persisted. */
  layout?: LayoutMode
}

export interface PersistedState {
  version: 2
  lastSelectedProjectId: string | null
  projects: Project[]
  groups: Group[]
  sidebarCollapsed: boolean
  sidebarWidthPct?: number
  /** Agent picked for the most recent terminal — the default for Ctrl+N. */
  lastAgent?: AgentId
  /** Right-side file explorer visible. Undefined = open. */
  explorerOpen?: boolean
  /** File explorer width in px. */
  explorerWidth?: number
}

/** Event posted by a Claude hook to the Status Bridge. */
export interface HookEvent {
  id: string            // ARW_TERMINAL_ID
  state?: TermState
  /** Claude session the terminal is on */
  sessionId?: string
}
