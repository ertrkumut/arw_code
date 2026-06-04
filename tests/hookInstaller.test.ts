import { describe, it, expect } from 'vitest'
import { mergeHooks, ARW_MARKER } from '@main/hookInstaller'

const ARW_CMD = 'node "/path/to/arw-hook.cjs" "${CLAUDE_HOOK_EVENT}"'

describe('mergeHooks', () => {
  it('adds hook entries to empty settings', () => {
    const out = mergeHooks({}, ARW_CMD)
    expect(out.hooks.Notification[0].hooks[0].command).toContain(ARW_MARKER)
    // hook object is schema-clean: only type + command
    expect(Object.keys(out.hooks.Notification[0].hooks[0]).sort()).toEqual(['command', 'type'])
  })

  it('preserves existing unrelated hooks', () => {
    const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }
    const out = mergeHooks(existing, ARW_CMD)
    const stopCmds = out.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(stopCmds).toContain('echo hi')                       // user hook kept
    expect(stopCmds.some((c: string) => c.includes(ARW_MARKER))).toBe(true) // arw hook added
  })

  it('is idempotent — running twice does not duplicate arw entries', () => {
    const once = mergeHooks({}, ARW_CMD)
    const twice = mergeHooks(once, ARW_CMD)
    const count = twice.hooks.Notification.flatMap((g: any) => g.hooks)
      .filter((h: any) => h.command.includes(ARW_MARKER)).length
    expect(count).toBe(1)
  })

  it('preserves other top-level settings keys', () => {
    const out = mergeHooks({ model: 'opus' } as any, ARW_CMD)
    expect((out as any).model).toBe('opus')
  })
})
