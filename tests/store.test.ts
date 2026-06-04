import { describe, it, expect } from 'vitest'
import { emptyState, addProject, addTerminal, removeProject, renameTerminal, serialize, deserialize } from '@main/store'

describe('store operations', () => {
  it('adds a project', () => {
    const s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    expect(s.projects).toHaveLength(1)
    expect(s.projects[0].terminals).toEqual([])
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

  it('deserialize rejects wrong version and returns empty', () => {
    expect(deserialize('{"version":99}')).toEqual(emptyState())
  })
})
