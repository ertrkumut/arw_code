import { describe, it, expect } from 'vitest'
import {
  emptyState, addProject, addTerminal, removeProject, renameTerminal, serialize, deserialize,
  addGroup, removeGroup, renameGroup, toggleGroup, setProjectGroup
} from '@main/store'

describe('store operations', () => {
  it('adds a project', () => {
    const s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    expect(s.projects).toHaveLength(1)
    expect(s.projects[0].terminals).toEqual([])
    expect(s.projects[0].groupId).toBeNull()
  })

  it('adds terminals with incrementing order', () => {
    let s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    s = addTerminal(s, 'p1', { id: 't1', name: 'one' })
    s = addTerminal(s, 'p1', { id: 't2', name: 'two' })
    expect(s.projects[0].terminals.map(t => t.order)).toEqual([0, 1])
  })

  it('renames a terminal', () => {
    let s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    s = addTerminal(s, 'p1', { id: 't1', name: 'one' })
    s = renameTerminal(s, 'p1', 't1', 'renamed')
    expect(s.projects[0].terminals[0].name).toBe('renamed')
  })

  it('removes a project', () => {
    let s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    s = removeProject(s, 'p1')
    expect(s.projects).toHaveLength(0)
  })

  it('serialize/deserialize round-trips', () => {
    let s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    s = addTerminal(s, 'p1', { id: 't1', name: 'one' })
    expect(deserialize(serialize(s))).toEqual(s)
  })

  it('deserialize rejects malformed blob and returns empty', () => {
    expect(deserialize('{"version":99}')).toEqual(emptyState())
  })
})

describe('groups', () => {
  it('emptyState is version 2 with empty groups and expanded sidebar', () => {
    const s = emptyState()
    expect(s.version).toBe(2)
    expect(s.groups).toEqual([])
    expect(s.sidebarCollapsed).toBe(false)
  })

  it('adds a group (expanded by default)', () => {
    const s = addGroup(emptyState(), { id: 'g1', name: 'Company' })
    expect(s.groups).toEqual([{ id: 'g1', name: 'Company', collapsed: false }])
  })

  it('removing a group returns its projects to Ungrouped (no orphans)', () => {
    let s = addGroup(emptyState(), { id: 'g1', name: 'Company' })
    s = addProject(s, { id: 'p1', name: 'api', path: 'C:\\api' })
    s = setProjectGroup(s, 'p1', 'g1', 0)
    expect(s.projects[0].groupId).toBe('g1')
    s = removeGroup(s, 'g1')
    expect(s.groups).toHaveLength(0)
    expect(s.projects[0].groupId).toBeNull()
  })

  it('renames and toggles a group', () => {
    let s = addGroup(emptyState(), { id: 'g1', name: 'Company' })
    s = renameGroup(s, 'g1', 'Side projects')
    expect(s.groups[0].name).toBe('Side projects')
    s = toggleGroup(s, 'g1')
    expect(s.groups[0].collapsed).toBe(true)
  })

  it('setProjectGroup moves a project into a group and positions it', () => {
    let s = addGroup(emptyState(), { id: 'g1', name: 'G' })
    s = addProject(s, { id: 'a', name: 'a', path: '/a' })
    s = addProject(s, { id: 'b', name: 'b', path: '/b' })
    s = addProject(s, { id: 'c', name: 'c', path: '/c' })
    // move c into g1 at index 0
    s = setProjectGroup(s, 'c', 'g1', 0)
    s = setProjectGroup(s, 'a', 'g1', 1) // a after c within g1
    const inG1 = s.projects.filter(p => p.groupId === 'g1').map(p => p.id)
    expect(inG1).toEqual(['c', 'a'])
    expect(s.projects.filter(p => p.groupId === null).map(p => p.id)).toEqual(['b'])
  })
})

describe('migration v1 -> v2', () => {
  it('upgrades a v1 blob: stamps version 2, adds groups, defaults groupId', () => {
    const v1 = JSON.stringify({
      version: 1,
      lastSelectedProjectId: 'p1',
      projects: [{ id: 'p1', name: 'api', path: 'C:\\api', collapsed: false, terminals: [] }]
    })
    const s = deserialize(v1)
    expect(s.version).toBe(2)
    expect(s.groups).toEqual([])
    expect(s.sidebarCollapsed).toBe(false)
    expect(s.projects[0].groupId).toBeNull()
    expect(s.lastSelectedProjectId).toBe('p1')
  })
})

describe('agent persistence', () => {
  const v2 = (extra: Record<string, unknown>) => JSON.stringify({
    version: 2, lastSelectedProjectId: null, projects: [], groups: [], sidebarCollapsed: false, ...extra
  })

  it('keeps a per-terminal agent through a save/load round-trip', () => {
    let s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    s = addTerminal(s, 'p1', { id: 't1', name: 'terminal 1', agent: 'gemini' })
    const back = deserialize(serialize(s))
    expect(back.projects[0].terminals[0].agent).toBe('gemini')
  })

  it('restores lastAgent, and falls back to claude when it is missing or junk', () => {
    expect(deserialize(v2({ lastAgent: 'kimi' })).lastAgent).toBe('kimi')
    expect(deserialize(v2({})).lastAgent).toBe('claude')
    expect(deserialize(v2({ lastAgent: 'bogus' })).lastAgent).toBe('claude')
  })

  it('no longer drops sidebarWidthPct on load', () => {
    expect(deserialize(v2({ sidebarWidthPct: 31 })).sidebarWidthPct).toBe(31)
  })
})
