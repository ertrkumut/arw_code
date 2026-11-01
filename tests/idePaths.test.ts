import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileKey, expressionAt, relativeTo, extOf, baseName } from '../src/renderer/ide/paths'
import { readTextFile, writeTextFile } from '@main/fileTree'

describe('fileKey', () => {
  it('normalizes Windows paths case-insensitively', () => {
    expect(fileKey('D:\\Proj\\Assets\\Player.cs', 'Win32')).toBe(fileKey('d:/proj/assets/player.cs', 'Win32'))
  })
  it('keeps case on POSIX', () => {
    expect(fileKey('/home/a/Foo.cs', 'Linux x86_64')).toBe('/home/a/Foo.cs')
    expect(fileKey('/home/a/', 'MacIntel')).toBe('/home/a')
  })
})

describe('path helpers', () => {
  it('relativeTo / extOf / baseName', () => {
    expect(relativeTo('D:\\Proj', 'D:\\Proj\\Assets\\A.cs')).toBe('Assets/A.cs')
    expect(relativeTo('D:\\Proj', 'E:\\Other\\A.cs')).toBe('E:/Other/A.cs')
    expect(extOf('Foo.Bar.CS')).toBe('cs')
    expect(extOf('.gitignore')).toBe('')
    expect(baseName('a\\b/c.txt')).toBe('c.txt')
  })
})

describe('expressionAt (debugger hover)', () => {
  const line = '    var y = transform.position.y + speed;'
  const col = (word: string) => line.indexOf(word) + 1
  it('includes the member-access chain left of the word', () => {
    expect(expressionAt(line, col('position'), col('position') + 'position'.length)).toBe('transform.position')
    expect(expressionAt(line, col('y +'), col('y +') + 1)).toBe('transform.position.y')
  })
  it('evaluates a plain identifier alone', () => {
    expect(expressionAt(line, col('speed'), col('speed') + 5)).toBe('speed')
  })
  it('rejects non-identifiers', () => {
    expect(expressionAt('a + 42', 5, 7)).toBeNull()
  })
})

describe('editor file IO', () => {
  let dir: string
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'arw-io-')) })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('strips and restores a UTF-8 BOM, keeps CRLF', async () => {
    const f = join(dir, 'Player.cs')
    writeFileSync(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('class A {}\r\n', 'utf8')]))
    const r = await readTextFile(f)
    expect(r).toEqual({ kind: 'text', content: 'class A {}\r\n', bom: true })
    await writeTextFile(f, 'class B {}\r\n', true)
    const raw = readFileSync(f)
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(raw.subarray(3).toString()).toBe('class B {}\r\n')
  })

  it('detects binary files', async () => {
    const f = join(dir, 'tex.png')
    writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
    expect((await readTextFile(f)).kind).toBe('binary')
  })
})
