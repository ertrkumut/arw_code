import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readDir, sortEntries, isExcluded } from '@main/fileTree'

describe('fileTree', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'arw-fx-'))
    mkdirSync(join(dir, 'src'))
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, 'b.txt'), '')
    writeFileSync(join(dir, 'A.md'), '')
    writeFileSync(join(dir, 'file10.ts'), '')
    writeFileSync(join(dir, 'file2.ts'), '')
    writeFileSync(join(dir, '.DS_Store'), '')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('lists folders first, natural case-insensitive order, hides VS Code default excludes', async () => {
    const entries = await readDir(dir)
    expect(entries.map(e => e.name)).toEqual(['src', 'A.md', 'b.txt', 'file2.ts', 'file10.ts'])
    expect(entries[0]).toEqual({ name: 'src', path: join(dir, 'src'), isDir: true })
  })

  it('sortEntries does not mutate input', () => {
    const input = [{ name: 'z', path: 'z', isDir: false }, { name: 'a', path: 'a', isDir: true }]
    expect(sortEntries(input).map(e => e.name)).toEqual(['a', 'z'])
    expect(input[0].name).toBe('z')
  })

  it('isExcluded', () => {
    expect(isExcluded('.git')).toBe(true)
    expect(isExcluded('node_modules')).toBe(false)
  })
})
