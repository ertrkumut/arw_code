import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DapFramer, encodeDap, compareVersions, findMonoDbg, type DapMessage } from '@main/debugAdapter'

describe('DAP framing', () => {
  it('round-trips messages split across arbitrary chunks', () => {
    const got: DapMessage[] = []
    const f = new DapFramer(m => got.push(m))
    const a = encodeDap({ seq: 1, type: 'event', event: 'output', body: { output: 'héllo ✓' } })
    const b = encodeDap({ seq: 2, type: 'response', request_seq: 1, success: true, command: 'initialize' })
    const all = Buffer.concat([a, b])
    for (let i = 0; i < all.length; i += 7) f.push(all.subarray(i, i + 7))
    expect(got.map(m => m.seq)).toEqual([1, 2])
    expect(got[0].body.output).toBe('héllo ✓')   // Content-Length counts bytes, not chars
  })

  it('handles two messages in one chunk', () => {
    const got: DapMessage[] = []
    const f = new DapFramer(m => got.push(m))
    f.push(Buffer.concat([encodeDap({ seq: 1, type: 'event' }), encodeDap({ seq: 2, type: 'event' })]))
    expect(got).toHaveLength(2)
  })
})

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('25.12.355', '25.9.400')).toBeGreaterThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('2.0.1', '10.0')).toBeLessThan(0)
  })
})

describe('findMonoDbg', () => {
  let root: string
  const exe = process.platform === 'win32' ? 'monodbg.exe' : 'monodbg'
  const install = (base: string, folder: string) => {
    const d = join(base, folder, 'extension', 'bin', 'DebuggerMono')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, exe), '')
    return join(d, exe)
  }
  beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'arw-dap-')) })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('picks the newest DotRush across editor extension folders', () => {
    const a = join(root, 'vscode'), b = join(root, 'antigravity')
    install(a, 'nromanov.dotrush-25.9.100-win32-x64')
    const newest = install(b, 'nromanov.dotrush-25.12.355-win32-x64')
    mkdirSync(join(a, 'nromanov.dotrush-26.0.0-win32-x64'))   // folder without the adapter is ignored
    expect(findMonoDbg([a, b, join(root, 'missing')], {})).toBe(newest)
  })

  it('prefers ARW_MONODBG when it exists', () => {
    const custom = install(join(root, 'custom'), 'x')
    expect(findMonoDbg([], { ARW_MONODBG: custom })).toBe(custom)
  })

  it('returns null when nothing is installed', () => {
    expect(findMonoDbg([join(root, 'nope')], {})).toBeNull()
  })
})
