export type TermState = 'working' | 'needs-you' | 'idle' | 'error'

export interface Terminal {
  id: string
  name: string
  order: number
}

export interface Project {
  id: string
  name: string
  path: string
  collapsed: boolean
  terminals: Terminal[]
}

export interface PersistedState {
  version: 1
  lastSelectedProjectId: string | null
  projects: Project[]
}

/** Event posted by a Claude hook to the Status Bridge. */
export interface HookEvent {
  id: string            // ARW_TERMINAL_ID
  state: TermState
}
