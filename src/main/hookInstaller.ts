export const ARW_MARKER = 'agent-manager'
const HOOK_EVENTS = ['PreToolUse', 'UserPromptSubmit', 'Notification', 'Stop'] as const

interface HookCmd { type: 'command'; command: string; __arw?: string }
interface HookGroup { matcher?: string; hooks: HookCmd[] }

/** Merge arw hook entries into a Claude settings object without clobbering user hooks. */
export function mergeHooks(settings: any, command: string): any {
  const out = { ...settings }
  out.hooks = { ...(settings.hooks ?? {}) }
  for (const ev of HOOK_EVENTS) {
    const groups: HookGroup[] = [...(out.hooks[ev] ?? [])]
      .map((g: HookGroup) => ({ ...g, hooks: g.hooks.filter((h) => h.__arw !== ARW_MARKER) }))
      .filter((g: HookGroup) => g.hooks.length > 0)
    groups.push({ hooks: [{ type: 'command', command, __arw: ARW_MARKER }] })
    out.hooks[ev] = groups
  }
  return out
}

// ---- install-to-disk wrapper ----
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'

const settingsPath = () => join(homedir(), '.claude', 'settings.json')

export function installHooks() {
  const scriptPath = join(__dirname, 'hook-script', 'arw-hook.cjs')
  const command = `node "${scriptPath}" "${'${CLAUDE_HOOK_EVENT}'}"`
  const p = settingsPath()
  const dir = dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const current = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
  if (existsSync(p) && !existsSync(p + '.arw-backup')) copyFileSync(p, p + '.arw-backup')
  const merged = mergeHooks(current, command)
  writeFileSync(p, JSON.stringify(merged, null, 2))
}
