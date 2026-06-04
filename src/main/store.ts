import type { PersistedState, Project, Terminal, Group } from '@shared/types'

export function emptyState(): PersistedState {
  return { version: 2, lastSelectedProjectId: null, projects: [], groups: [], sidebarCollapsed: false }
}

export function addProject(s: PersistedState, p: Omit<Project, 'collapsed' | 'terminals' | 'groupId'>): PersistedState {
  return { ...s, projects: [...s.projects, { ...p, collapsed: false, terminals: [], groupId: null }] }
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

// ---- Groups ----

export function addGroup(s: PersistedState, g: Omit<Group, 'collapsed'>): PersistedState {
  return { ...s, groups: [...s.groups, { ...g, collapsed: false }] }
}

/** Remove a group; its projects fall back to the Ungrouped section (no orphans). */
export function removeGroup(s: PersistedState, groupId: string): PersistedState {
  return {
    ...s,
    groups: s.groups.filter(g => g.id !== groupId),
    projects: s.projects.map(p => (p.groupId === groupId ? { ...p, groupId: null } : p))
  }
}

export function renameGroup(s: PersistedState, groupId: string, name: string): PersistedState {
  return { ...s, groups: s.groups.map(g => (g.id === groupId ? { ...g, name } : g)) }
}

export function toggleGroup(s: PersistedState, groupId: string): PersistedState {
  return { ...s, groups: s.groups.map(g => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)) }
}

/**
 * Move a project into `groupId` (null = Ungrouped) and place it at `toIndex`
 * within that section's slice of the global projects array. Array order is the
 * single source of truth for display ordering within a section.
 */
export function setProjectGroup(
  s: PersistedState,
  projectId: string,
  groupId: string | null,
  toIndex: number
): PersistedState {
  const moving = s.projects.find(p => p.id === projectId)
  if (!moving) return s
  const rest = s.projects.filter(p => p.id !== projectId)
  const updated: Project = { ...moving, groupId }
  // Indices in `rest` that belong to the destination section, in array order.
  const destPositions = rest
    .map((p, i) => (p.groupId === groupId ? i : -1))
    .filter(i => i !== -1)
  const clamped = Math.max(0, Math.min(toIndex, destPositions.length))
  // Insert before the destPositions[clamped]-th sibling, or at end of array.
  const insertAt = clamped < destPositions.length ? destPositions[clamped] : rest.length
  const next = [...rest.slice(0, insertAt), updated, ...rest.slice(insertAt)]
  return { ...s, projects: next }
}

export function serialize(s: PersistedState): string { return JSON.stringify(s, null, 2) }

/** Migrate a parsed v1 blob to the current shape. */
function migrate(parsed: any): PersistedState | null {
  if (!parsed || !Array.isArray(parsed.projects)) return null
  if (parsed.version === 2) {
    return {
      version: 2,
      lastSelectedProjectId: parsed.lastSelectedProjectId ?? null,
      projects: parsed.projects.map((p: any) => ({ ...p, groupId: p.groupId ?? null })),
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      sidebarCollapsed: !!parsed.sidebarCollapsed
    }
  }
  if (parsed.version === 1) {
    return {
      version: 2,
      lastSelectedProjectId: parsed.lastSelectedProjectId ?? null,
      projects: parsed.projects.map((p: any) => ({ ...p, groupId: null })),
      groups: [],
      sidebarCollapsed: false
    }
  }
  return null
}

export function deserialize(raw: string): PersistedState {
  try {
    const migrated = migrate(JSON.parse(raw))
    return migrated ?? emptyState()
  } catch { return emptyState() }
}

import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

function userDataFile(): string {
  const { app } = require('electron') as typeof import('electron')
  return join(app.getPath('userData'), 'agent-manager-state.json')
}

export function loadState(): PersistedState {
  const f = userDataFile()
  return existsSync(f) ? deserialize(readFileSync(f, 'utf8')) : emptyState()
}

let timer: NodeJS.Timeout | null = null
export function saveStateDebounced(s: PersistedState, ms = 300): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => writeFileSync(userDataFile(), serialize(s)), ms)
}
