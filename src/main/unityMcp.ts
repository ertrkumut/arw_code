import { join, dirname, delimiter } from 'node:path'
import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync } from 'node:fs'

/**
 * Unity ships a CLI (`unity`) whose bare `unity mcp` subcommand is a stdio MCP
 * server for a running Unity Editor. It is NOT a chat agent — it's the execution
 * surface an agent drives, which is why Unity lives here and not in AGENTS.
 *
 * ARWCode's job is to hand that surface to the agent panes it spawns: when a
 * terminal's cwd is a Unity project, drop a project-scoped `.mcp.json` next to it
 * so Claude Code discovers the server pinned to that exact project directory.
 */

/** Key we own inside `.mcp.json`'s `mcpServers`. */
export const UNITY_SERVER_KEY = 'unity'

/** File Claude Code reads for project-scoped MCP servers. */
export const MCP_FILE = '.mcp.json'

export interface McpServerSpec {
  type: 'stdio'
  command: string
  args: string[]
}

/** Every Unity project has this file; it's the only reliable on-disk marker. */
export function isUnityProject(dir: string): boolean {
  return existsSync(join(dir, 'ProjectSettings', 'ProjectVersion.txt'))
}

/** Editor version a project is pinned to, e.g. "6000.3.7f1". Null when unreadable. */
export function unityEditorVersion(dir: string): string | null {
  try {
    const txt = readFileSync(join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    return /^m_EditorVersion:\s*(.+)$/m.exec(txt)?.[1].trim() ?? null
  } catch {
    return null
  }
}

/** The server entry ARWCode writes for a given project directory. */
export function unityServerSpec(projectPath: string): McpServerSpec {
  return { type: 'stdio', command: 'unity', args: ['mcp', '--project-path', projectPath] }
}

// A pre-existing `unity` entry is only ours to rewrite if it actually launches the
// Unity CLI. Someone's hand-rolled server that happens to be named "unity" (an HTTP
// bridge, a wrapper script) stays exactly as they wrote it.
function isOurs(entry: any): boolean {
  const cmd = String(entry?.command ?? '').toLowerCase().replace(/\.(exe|cmd|bat)$/, '')
  return cmd === 'unity' || cmd.endsWith('/unity') || cmd.endsWith('\\unity')
}

export type MergeResult =
  | { action: 'write'; config: any }
  | { action: 'unchanged' }
  | { action: 'foreign' }

/**
 * Merge our server into an `.mcp.json` object without touching any other key.
 * Pure — callers decide whether to hit disk. `unchanged` keeps repeated terminal
 * spawns from rewriting (and dirtying) a file that already says the right thing.
 */
export function mergeUnityServer(config: any, projectPath: string): MergeResult {
  const servers = { ...(config?.mcpServers ?? {}) }
  const existing = servers[UNITY_SERVER_KEY]
  if (existing && !isOurs(existing)) return { action: 'foreign' }

  const spec = unityServerSpec(projectPath)
  if (existing && JSON.stringify(existing) === JSON.stringify(spec)) return { action: 'unchanged' }

  servers[UNITY_SERVER_KEY] = spec
  return { action: 'write', config: { ...(config ?? {}), mcpServers: servers } }
}

// ---- CLI discovery ----

// Resolved once per app run: the answer can't change while ARWCode is open, and
// this sits on the terminal-spawn path where an fs walk per pane would be waste.
let cliCache: string | null | undefined

// Deliberately lstat, not existsSync. Unity ships the Windows CLI as an MSIX
// package, so `unity.exe` on PATH is an app-execution alias under WindowsApps --
// a reparse point that existsSync/statSync fail on with EACCES because they try
// to follow it. lstat inspects the entry itself and succeeds, so this is the
// difference between detecting the normal Windows install and never seeing it.
function isExecutableEntry(p: string): boolean {
  try {
    const st = lstatSync(p)
    return st.isFile() || st.isSymbolicLink()
  } catch {
    return false
  }
}

/** Absolute path to the `unity` binary, or null when the CLI isn't installed. */
export function unityCliPath(): string | null {
  if (cliCache !== undefined) return cliCache
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : ['']
  cliCache = null
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join(dir, 'unity' + ext)
      if (isExecutableEntry(p)) { cliCache = p; return cliCache }
    }
  }
  return cliCache
}

/** Test seam — forget a cached lookup. */
export function resetUnityCliCache() { cliCache = undefined }

// ---- install-to-disk wrapper ----

export type EnsureStatus = 'not-unity' | 'no-cli' | 'configured' | 'already' | 'foreign'

/**
 * Give the agent running in `dir` a Unity MCP server, if `dir` is a Unity project
 * and the CLI is installed. Safe and cheap to call on every terminal spawn: it
 * short-circuits on the existsSync marker and never rewrites an up-to-date file.
 */
export function ensureUnityMcp(dir: string): EnsureStatus {
  if (!isUnityProject(dir)) return 'not-unity'
  if (!unityCliPath()) return 'no-cli'

  const p = join(dir, MCP_FILE)
  let current: any = {}
  if (existsSync(p)) {
    try { current = JSON.parse(readFileSync(p, 'utf8')) } catch { current = {} }
  }

  const merged = mergeUnityServer(current, dir)
  if (merged.action === 'unchanged') return 'already'
  if (merged.action === 'foreign') return 'foreign'

  // Same guardrails as the Claude hook installer: one-time backup of whatever was
  // there before we ever touched it, then an atomic tmp+rename so a crash mid-write
  // can't leave the agent with a truncated config.
  if (existsSync(p) && !existsSync(p + '.arw-backup')) copyFileSync(p, p + '.arw-backup')
  const parent = dirname(p)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
  writeFileSync(p + '.tmp', JSON.stringify(merged.config, null, 2) + '\n')
  renameSync(p + '.tmp', p)
  return 'configured'
}
