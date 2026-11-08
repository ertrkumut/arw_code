import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentEditTracker } from '@main/agentEdits'

const flush = () => new Promise(r => setTimeout(r, 30))

describe('AgentEditTracker', () => {
  it('keeps the pre-edit text of an edited file, and drops it once reviewed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arw-edits-'))
    const f = join(dir, 'A.cs')
    writeFileSync(f, 'a\nB\nc\n')
    const seen: any[] = []
    const t = new AgentEditTracker((path, edit) => seen.push({ path, edit }))
    t.noteEvent({ type: 'user', tool_use_result: { filePath: f,
      structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' a', '-b', '+B', ' c'] }] } })
    await flush()
    expect(t.list()).toEqual([{ path: f, baseline: 'a\nb\nc\n' }])
    // a second edit keeps the older baseline
    writeFileSync(f, 'a\nB\nC\n')
    t.noteEvent({ type: 'user', tool_use_result: { filePath: f,
      structuredPatch: [{ oldStart: 2, oldLines: 2, newStart: 2, newLines: 2, lines: [' B', '-c', '+C'] }] } })
    await flush()
    expect(t.list()[0].baseline).toBe('a\nb\nc\n')
    t.set(f, null)
    expect(t.list()).toEqual([])
    expect(seen.at(-1)).toEqual({ path: f, edit: null })
  })

  it('tracks a created file with an empty baseline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arw-edits-'))
    const f = join(dir, 'New.cs')
    writeFileSync(f, 'class New {}\n')
    const t = new AgentEditTracker(() => {})
    t.noteEvent({ type: 'user', tool_use_result: { type: 'create', filePath: f, content: 'class New {}\n', structuredPatch: [] } })
    await flush()
    expect(t.list()).toEqual([{ path: f, baseline: '', created: true }])
  })
})
