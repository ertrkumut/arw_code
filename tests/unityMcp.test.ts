import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isUnityProject, unityEditorVersion, unityServerSpec, mergeUnityServer,
  ensureUnityMcp, unityCliPath, resetUnityCliCache, UNITY_SERVER_KEY, MCP_FILE
} from '@main/unityMcp'

// A Windows path built without literal escapes, so the expectation stays
// readable next to the forward-slash cases.
const WIN = 'C:' + '\\' + 'Game'

let dir: string
const mcp = () => join(dir, MCP_FILE)
const readMcp = () => JSON.parse(readFileSync(mcp(), 'utf8'))

/** Turn the temp dir into something Unity (and ARWCode) recognises as a project. */
function makeUnityProject(version = '6000.3.7f1') {
  mkdirSync(join(dir, 'ProjectSettings'), { recursive: true })
  writeFileSync(join(dir, 'ProjectSettings', 'ProjectVersion.txt'),
    `m_EditorVersion: ${version}\nm_EditorVersionWithRevision: ${version} (abc123def456)\n`)
}

/** ensureUnityMcp bails without a real CLI, so fake one onto PATH. */
function fakeUnityCli() {
  const bin = mkdtempSync(join(tmpdir(), 'arw-bin-'))
  writeFileSync(join(bin, process.platform === 'win32' ? 'unity.exe' : 'unity'), '')
  process.env.PATH = bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH
  resetUnityCliCache()
  return bin
}

let originalPath: string | undefined
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arw-unity-'))
  originalPath = process.env.PATH
  resetUnityCliCache()
})
afterEach(() => {
  process.env.PATH = originalPath
  resetUnityCliCache()
  rmSync(dir, { recursive: true, force: true })
})

describe('unity project detection', () => {
  it('rejects a plain directory', () => {
    expect(isUnityProject(dir)).toBe(false)
  })

  it('accepts a directory with ProjectSettings/ProjectVersion.txt', () => {
    makeUnityProject()
    expect(isUnityProject(dir)).toBe(true)
  })

  it('reads the pinned editor version', () => {
    makeUnityProject('2022.3.51f1')
    expect(unityEditorVersion(dir)).toBe('2022.3.51f1')
  })

  it('returns null when there is no version file', () => {
    expect(unityEditorVersion(dir)).toBeNull()
  })
})

describe('mergeUnityServer', () => {
  it('adds the server to an empty config', () => {
    const r = mergeUnityServer({}, WIN)
    expect(r.action).toBe('write')
    expect((r as any).config.mcpServers[UNITY_SERVER_KEY])
      .toEqual({ type: 'stdio', command: 'unity', args: ['mcp', '--project-path', WIN] })
  })

  it('pins the server to the directory it was given', () => {
    expect(unityServerSpec('/wt/feature').args).toEqual(['mcp', '--project-path', '/wt/feature'])
  })

  it('leaves unrelated servers untouched', () => {
    const r = mergeUnityServer({ mcpServers: { github: { command: 'gh-mcp' } } }, '/g')
    expect((r as any).config.mcpServers.github).toEqual({ command: 'gh-mcp' })
  })

  it('preserves unrelated top-level keys', () => {
    const r = mergeUnityServer({ $schema: 'x', mcpServers: {} }, '/g')
    expect((r as any).config.$schema).toBe('x')
  })

  it('reports unchanged when the entry already matches', () => {
    const first = mergeUnityServer({}, '/g') as any
    expect(mergeUnityServer(first.config, '/g').action).toBe('unchanged')
  })

  it('rewrites a stale project path', () => {
    const first = mergeUnityServer({}, '/old') as any
    const second = mergeUnityServer(first.config, '/new')
    expect(second.action).toBe('write')
    expect((second as any).config.mcpServers[UNITY_SERVER_KEY].args)
      .toEqual(['mcp', '--project-path', '/new'])
  })

  it('refuses to clobber a foreign server named unity', () => {
    const r = mergeUnityServer({ mcpServers: { unity: { command: 'python', args: ['bridge.py'] } } }, '/g')
    expect(r.action).toBe('foreign')
  })

  it('still owns an absolute-path unity command', () => {
    const r = mergeUnityServer(
      { mcpServers: { unity: { command: WIN + '\\unity.exe', args: ['mcp'] } } }, '/g')
    expect(r.action).toBe('write')
  })
})

describe('unityCliPath', () => {
  it('returns null when unity is not on PATH', () => {
    process.env.PATH = mkdtempSync(join(tmpdir(), 'arw-empty-'))
    resetUnityCliCache()
    expect(unityCliPath()).toBeNull()
  })

  it('finds unity on PATH', () => {
    fakeUnityCli()
    expect(unityCliPath()).not.toBeNull()
  })
})

describe('ensureUnityMcp', () => {
  it('does nothing for a non-Unity directory', () => {
    fakeUnityCli()
    expect(ensureUnityMcp(dir)).toBe('not-unity')
    expect(existsSync(mcp())).toBe(false)
  })

  it('does nothing when the CLI is missing', () => {
    makeUnityProject()
    process.env.PATH = mkdtempSync(join(tmpdir(), 'arw-empty-'))
    resetUnityCliCache()
    expect(ensureUnityMcp(dir)).toBe('no-cli')
    expect(existsSync(mcp())).toBe(false)
  })

  it('writes .mcp.json pinned to the project directory', () => {
    makeUnityProject(); fakeUnityCli()
    expect(ensureUnityMcp(dir)).toBe('configured')
    expect(readMcp().mcpServers[UNITY_SERVER_KEY].args).toEqual(['mcp', '--project-path', dir])
  })

  it('is idempotent across repeated terminal spawns', () => {
    makeUnityProject(); fakeUnityCli()
    expect(ensureUnityMcp(dir)).toBe('configured')
    expect(ensureUnityMcp(dir)).toBe('already')
  })

  it('backs up a pre-existing .mcp.json exactly once', () => {
    makeUnityProject(); fakeUnityCli()
    writeFileSync(mcp(), JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } }))
    ensureUnityMcp(dir)
    expect(JSON.parse(readFileSync(mcp() + '.arw-backup', 'utf8')).mcpServers.github)
      .toEqual({ command: 'gh-mcp' })
    expect(readMcp().mcpServers.github).toEqual({ command: 'gh-mcp' })
  })

  it('recovers from a corrupt .mcp.json instead of throwing', () => {
    makeUnityProject(); fakeUnityCli()
    writeFileSync(mcp(), '{ not json')
    expect(ensureUnityMcp(dir)).toBe('configured')
    expect(readMcp().mcpServers[UNITY_SERVER_KEY]).toBeTruthy()
  })

  it('leaves a foreign unity server alone', () => {
    makeUnityProject(); fakeUnityCli()
    writeFileSync(mcp(), JSON.stringify({ mcpServers: { unity: { command: 'python' } } }))
    expect(ensureUnityMcp(dir)).toBe('foreign')
    expect(readMcp().mcpServers.unity).toEqual({ command: 'python' })
  })
})
