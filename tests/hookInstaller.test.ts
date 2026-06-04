import { describe, it, expect } from 'vitest'
import { mergeHooks, ARW_MARKER } from '@main/hookInstaller'

describe('mergeHooks', () => {
  it('adds hook entries to empty settings', () => {
    const out = mergeHooks({}, 'node /path/arw-hook.cjs')
    expect(out.hooks.Notification[0].hooks[0].command).toContain('arw-hook.cjs')
    expect(out.hooks.Notification[0].hooks[0].__arw).toBe(ARW_MARKER)
  })

  it('preserves existing unrelated hooks', () => {
    const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }
    const out = mergeHooks(existing, 'cmd')
    const stopCmds = out.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(stopCmds).toContain('echo hi')        // user hook kept
    expect(stopCmds.some((c: string) => c === 'cmd')).toBe(true) // arw hook added
  })

  it('is idempotent — running twice does not duplicate arw entries', () => {
    const once = mergeHooks({}, 'cmd')
    const twice = mergeHooks(once, 'cmd')
    const count = twice.hooks.Notification.flatMap((g: any) => g.hooks)
      .filter((h: any) => h.__arw === ARW_MARKER).length
    expect(count).toBe(1)
  })

  it('preserves other top-level settings keys', () => {
    const out = mergeHooks({ model: 'opus' } as any, 'cmd')
    expect((out as any).model).toBe('opus')
  })
})
