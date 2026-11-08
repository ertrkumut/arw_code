import { describe, it, expect } from 'vitest'
import { diffLines, baselineFromPatch, firstChangedLine, acceptHunk, splitLines } from '../src/shared/agentEdits'

/** Apply hunks to a → must give b. */
function applyAll(a: string[], b: string[]) {
  const out: string[] = []
  let i = 0
  for (const h of diffLines(a, b)) {
    out.push(...a.slice(i, h.origStart), ...b.slice(h.modStart, h.modStart + h.modCount))
    i = h.origStart + h.origCount
  }
  return [...out, ...a.slice(i)]
}

describe('diffLines', () => {
  it('finds no hunks for equal input', () => { expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([]) })
  it('finds an insertion', () => {
    expect(diffLines(['a', 'c'], ['a', 'b', 'c'])).toEqual([{ origStart: 1, origCount: 0, modStart: 1, modCount: 1 }])
  })
  it('finds a deletion and a change', () => {
    expect(diffLines(['a', 'b', 'c', 'd', 'e'], ['a', 'c', 'D', 'e'])).toEqual([
      { origStart: 1, origCount: 1, modStart: 1, modCount: 0 },
      { origStart: 3, origCount: 1, modStart: 2, modCount: 1 }
    ])
  })
  it('hunks rebuild the target (random)', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: Math.floor(rnd() * 30) }, () => 'xyzw'[Math.floor(rnd() * 4)])
      const b = Array.from({ length: Math.floor(rnd() * 30) }, () => 'xyzw'[Math.floor(rnd() * 4)])
      expect(applyAll(a, b)).toEqual(b)
    }
  })
})

describe('baselineFromPatch', () => {
  const patch = [{ oldStart: 2, oldLines: 3, newStart: 2, newLines: 4, lines: [' b', '-c', '+C', '+C2', ' d'] }]
  it('reverses an edit', () => { expect(baselineFromPatch('a\nb\nC\nC2\nd\ne', patch)).toBe('a\nb\nc\nd\ne') })
  it('keeps CRLF', () => { expect(baselineFromPatch('a\r\nb\r\nC\r\nC2\r\nd\r\n', patch)).toBe('a\r\nb\r\nc\r\nd\r\n') })
  it('returns null when the file no longer matches', () => { expect(baselineFromPatch('a\nb\nX\nd', patch)).toBeNull() })
})

describe('firstChangedLine', () => {
  it('skips leading context', () => {
    expect(firstChangedLine([{ oldStart: 54, oldLines: 6, newStart: 54, newLines: 7, lines: [' a', ' b', ' c', '+n', ' d'] }])).toBe(57)
  })
  it('is undefined without a patch', () => { expect(firstChangedLine(undefined)).toBeUndefined() })
})

describe('acceptHunk', () => {
  it('moves one change into the baseline', () => {
    const base = splitLines('a\nb\nc\nd'), cur = splitLines('a\nB\nc\nD')
    const [h1] = diffLines(base, cur)
    const next = acceptHunk(base, cur, h1)
    expect(next).toEqual(['a', 'B', 'c', 'd'])
    expect(diffLines(next, cur)).toHaveLength(1)
  })
})
