import type { PersistedState, Project, Terminal } from '@shared/types'

export function emptyState(): PersistedState {
  return { version: 1, lastSelectedProjectId: null, projects: [] }
}

export function addProject(s: PersistedState, p: Omit<Project, 'collapsed' | 'terminals'>): PersistedState {
  return { ...s, projects: [...s.projects, { ...p, collapsed: false, terminals: [] }] }
}

export function removeProject(s: PersistedState, projectId: string): PersistedState {
  return { ...s, projects: s.projects.filter(p => p.id !== projectId) }
}

function mapProject(s: PersistedState, projectId: string, fn: (p: Project) => Project): PersistedState {
  return { ...s, projects: s.projects.map(p => (p.id === projectId ? fn(p) : p)) }
}

export function addTerminal(s: PersistedState, projectId: string, t: Omit<Terminal, 'order'>): PersistedState {
  return mapProject(s, projectId, p => ({
    ...p, terminals: [...p.terminals, { ...t, order: p.terminals.length }]
  }))
}

export function removeTerminal(s: PersistedState, projectId: string, termId: string): PersistedState {
  return mapProject(s, projectId, p => ({ ...p, terminals: p.terminals.filter(t => t.id !== termId) }))
}

export function renameTerminal(s: PersistedState, projectId: string, termId: string, name: string): PersistedState {
  return mapProject(s, projectId, p => ({
    ...p, terminals: p.terminals.map(t => (t.id === termId ? { ...t, name } : t))
  }))
}

export function serialize(s: PersistedState): string { return JSON.stringify(s, null, 2) }

export function deserialize(raw: string): PersistedState {
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1 || !Array.isArray(parsed.projects)) return emptyState()
    return parsed as PersistedState
  } catch { return emptyState() }
}
