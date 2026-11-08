/**
 * Claude's edits, reviewed in the IDE (Antigravity-style).
 *
 * For every file Claude edits, main keeps a *baseline*: the file as it was before Claude's
 * first not-yet-reviewed edit. The IDE diffs the live buffer against it and shows what
 * changed; accepting a change moves it into the baseline, rejecting puts the baseline text
 * back into the file. Pure helpers, shared by main and renderer.
 */
import type { DiffHunk } from './chatModel'

/** One tracked file. `baseline` '' + `created` = Claude made the file. */
export interface AgentEdit { path: string; baseline: string; created?: boolean }

/** A changed region, 0-based: lines [origStart, origStart+origCount) became [modStart, modStart+modCount). */
export interface LineHunk { origStart: number; origCount: number; modStart: number; modCount: number }

export const splitLines = (s: string) => s.split(/\r?\n/)

/** Line diff (Myers), with common prefix/suffix trimmed first. Huge rewrites come back as one hunk. */
export function diffLines(a: string[], b: string[]): LineHunk[] {
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf)
  const N = A.length, M = B.length
  if (!N && !M) return []
  if (!N || !M || N + M > 16000) return [{ origStart: pre, origCount: N, modStart: pre, modCount: M }]

  const max = N + M, off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < N && y < M && A[x] === B[y]) { x++; y++ }
      v[off + k] = x
      if (x >= N && y >= M) break outer
    }
  }

  // Walk back through the trace collecting matched line pairs.
  const matches: [number, number][] = []
  let x = N, y = M
  for (let d = trace.length - 1; d > 0; d--) {
    const vd = trace[d], k = x - y
    const prevK = k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1]) ? k + 1 : k - 1
    const prevX = vd[off + prevK], prevY = prevX - prevK
    while (x > prevX && y > prevY) { x--; y--; matches.push([x, y]) }
    x = prevX; y = prevY
  }
  while (x > 0 && y > 0) { x--; y--; matches.push([x, y]) }
  matches.reverse()

  const out: LineHunk[] = []
  let ai = 0, bi = 0
  const flush = (ax: number, by: number) => {
    if (ax > ai || by > bi) out.push({ origStart: pre + ai, origCount: ax - ai, modStart: pre + bi, modCount: by - bi })
  }
  for (const [mx, my] of matches) { flush(mx, my); ai = mx + 1; bi = my + 1 }
  flush(N, M)
  return out
}

/**
 * The file before an edit, from the file after it and the edit's structured patch.
 * Null when the patch doesn't match the file (it changed again in between).
 */
export function baselineFromPatch(current: string, patch: DiffHunk[]): string | null {
  const eol = current.includes('\r\n') ? '\r\n' : '\n'
  const lines = splitLines(current)
  const clean = (l: string) => l.slice(1).replace(/\r$/, '')
  for (const h of [...patch].sort((p, q) => q.newStart - p.newStart)) {
    const body = h.lines.filter(l => l[0] !== '\\')
    const neu = body.filter(l => l[0] !== '-').map(clean)
    const old = body.filter(l => l[0] !== '+').map(clean)
    const start = h.newLines === 0 ? h.newStart : h.newStart - 1
    if (start < 0) return null
    for (let i = 0; i < neu.length; i++) if ((lines[start + i] ?? '').replace(/\r$/, '') !== neu[i]) return null
    lines.splice(start, neu.length, ...old)
  }
  return lines.join(eol)
}

/** 1-based line where an edit's first change is (what to jump to from the chat). */
export function firstChangedLine(patch?: DiffHunk[]): number | undefined {
  const h = patch?.length ? [...patch].sort((p, q) => p.newStart - q.newStart)[0] : undefined
  if (!h) return undefined
  let n = Math.max(1, h.newStart)
  for (const l of h.lines) {
    if (l[0] === '+' || l[0] === '-') return n
    if (l[0] === ' ') n++
  }
  return Math.max(1, h.newStart)
}

/** Baseline with one hunk accepted (the hunk's new lines copied in). */
export function acceptHunk(baseline: string[], current: string[], h: LineHunk): string[] {
  const next = baseline.slice()
  next.splice(h.origStart, h.origCount, ...current.slice(h.modStart, h.modStart + h.modCount))
  return next
}

/** +added / −removed line counts of a diff. */
export function diffStat(hunks: LineHunk[]) {
  let add = 0, del = 0
  for (const h of hunks) { add += h.modCount; del += h.origCount }
  return { add, del }
}

/** Same text, ignoring line endings and a BOM. */
export const sameText = (a: string, b: string) =>
  a.replace(/^﻿/, '').replace(/\r\n/g, '\n') === b.replace(/^﻿/, '').replace(/\r\n/g, '\n')
