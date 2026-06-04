export type TermState = 'working' | 'needs-you' | 'idle' | 'error'

export interface Terminal {
  id: string
  name: string
  order: number
  /** Preset hex used to tint the pane header + focus accent. Undefined = default teal. Persisted. */
  color?: string
  /** Transient: true while the terminal lives in a torn-off window. Never persisted. */
  detached?: boolean
}

export interface Group {
  id: string
  name: string
  collapsed: boolean
}

export interface Project {
  id: string
  name: string
  path: string
  collapsed: boolean
  terminals: Terminal[]
  groupId: string | null   // null = Ungrouped section
}

export interface PersistedState {
  version: 2
  lastSelectedProjectId: string | null
  projects: Project[]
  groups: Group[]
  sidebarCollapsed: boolean
}

/** Event posted by a Claude hook to the Status Bridge. */
export interface HookEvent {
  id: string            // ARW_TERMINAL_ID
  state: TermState
}
