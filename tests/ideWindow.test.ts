import { describe, it, expect } from 'vitest'
import { applyIdePatch, emptyIdeState, openTabPatch } from '@main/ideState'
import { fuzzyScore } from '../src/renderer/ide/fuzzy'

const key = (p: string) => p.replace(/\\/g, '/').toLowerCase()

describe('IDE state patches', () => {
  it('merges per key so windows do not clobber each other', () => {
    let s = emptyIdeState()
    s = applyIdePatch(s, { breakpoints: { a: { path: 'A.cs', lines: [3] } }, tabs: { p1: { paths: ['A.cs'], active: 'A.cs' } } })
    s = applyIdePatch(s, { breakpoints: { b: { path: 'B.cs', lines: [7] } }, themeId: 'rider-dark' })
    expect(Object.keys(s.breakpoints).sort()).toEqual(['a', 'b'])
    expect(s.tabs.p1.active).toBe('A.cs')
    expect(s.themeId).toBe('rider-dark')
    s = applyIdePatch(s, { breakpoints: { a: null, b: { path: 'B.cs', lines: [] } }, tabs: { p1: null } })
    expect(s.breakpoints).toEqual({})
    expect(s.tabs).toEqual({})
  })

  it('openTabPatch adds once and activates', () => {
    const A = String.raw`D:\P\A.cs`, B = String.raw`D:\P\B.cs`
    let s = emptyIdeState()
    s = applyIdePatch(s, openTabPatch(s, 'p', A, key))
    s = applyIdePatch(s, openTabPatch(s, 'p', B, key))
    s = applyIdePatch(s, openTabPatch(s, 'p', 'd:/p/a.cs', key))
    expect(s.tabs.p).toEqual({ paths: [A, B], active: A })
  })
})

describe('Go to File fuzzy match', () => {
  it('prefers file-name matches and word starts', () => {
    const files = ['Assets/Scripts/PlayerController.cs', 'Assets/Player/Readme.md', 'Assets/Scripts/Enemy.cs']
    const ranked = files.map(f => [f, fuzzyScore('plc', f)] as const).filter(x => x[1] >= 0).sort((a, b) => b[1] - a[1])
    expect(ranked[0][0]).toBe('Assets/Scripts/PlayerController.cs')
    expect(fuzzyScore('zzz', files[0])).toBe(-1)
  })
})
