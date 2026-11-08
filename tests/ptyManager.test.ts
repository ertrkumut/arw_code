import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fake IPty so we never touch the native node-pty binding (which can't build on
// this Windows env) — we drive onData/onExit by hand to exercise PtyManager.
type Handler<T> = (arg: T) => void
class FakePty {
  dataHandlers: Handler<string>[] = []
  exitHandlers: Handler<{ exitCode: number }>[] = []
  written: string[] = []
  killed = false
  onData(h: Handler<string>) { this.dataHandlers.push(h) }
  onExit(h: Handler<{ exitCode: number }>) { this.exitHandlers.push(h) }
  write(d: string) { this.written.push(d) }
  resize() {}
  kill() { this.killed = true }
  emitData(d: string) { this.dataHandlers.forEach(h => h(d)) }
  emitExit(code: number) { this.exitHandlers.forEach(h => h({ exitCode: code })) }
}

let lastPty: FakePty
vi.mock('@homebridge/node-pty-prebuilt-multiarch', () => ({
  spawn: () => { lastPty = new FakePty(); return lastPty }
}))

import { PtyManager } from '../src/main/ptyManager'
import { AGENTS } from '../src/shared/agents'

const opts = { id: 't1', cwd: '.', eventUrl: 'http://x/event', cols: 80, rows: 24 }

describe('PtyManager status inference', () => {
  beforeEach(() => vi.useRealTimers())

  it('pipes pty output to onData but never infers a status from it', () => {
    vi.useFakeTimers()
    const onData = vi.fn()
    const onInferred = vi.fn()      // a status sink — must stay empty
    // onInferred is passed where the old inferred-status callback used to live.
    // The fix removed that wiring; this slot is now onError, which data must not trigger.
    const mgr = new PtyManager(onData, vi.fn(), onInferred)
    mgr.spawn(opts)
    lastPty.emitData('PS C:\\> ')   // shell prompt — used to flip the dot green
    lastPty.emitData('claude starting...\r\n')

    expect(onData).toHaveBeenCalledWith('t1', 'PS C:\\> ')
    vi.advanceTimersByTime(10_000)  // long past the old 2.5s idle fallback
    expect(onInferred).not.toHaveBeenCalled()
  })

  it('reports a non-zero exit so the shell can be flagged as errored', () => {
    const onExit = vi.fn()
    const mgr = new PtyManager(vi.fn(), onExit)
    mgr.spawn(opts)
    lastPty.emitExit(1)
    expect(onExit).toHaveBeenCalledWith('t1', 1)
  })
})

describe('PtyManager agent launch command', () => {
  const launched = () => lastPty.written[0]
  // A fresh Claude terminal pins its own session id so its transcript can be found later.
  const freshClaude = new RegExp(`^${AGENTS.claude.command} --session-id [0-9a-f-]{36} --model opus\\r$`)

  it('launches the selected CLI', () => {
    new PtyManager(vi.fn(), vi.fn()).spawn({ ...opts, agent: 'gemini' })
    expect(launched()).toBe(AGENTS.gemini.command + '\r')

    new PtyManager(vi.fn(), vi.fn()).spawn({ ...opts, agent: 'kimi' })
    expect(launched()).toBe(AGENTS.kimi.command + '\r')

    new PtyManager(vi.fn(), vi.fn()).spawn({ ...opts, agent: 'codex' })
    expect(launched()).toBe(AGENTS.codex.command + '\r')
  })

  it('falls back to Claude when no agent is given (terminals saved before the picker existed)', () => {
    new PtyManager(vi.fn(), vi.fn()).spawn(opts)
    expect(launched()).toMatch(freshClaude)
  })

  it('falls back to Claude for an unrecognised agent id rather than running nothing', () => {
    new PtyManager(vi.fn(), vi.fn()).spawn({ ...opts, agent: 'not-an-agent' })
    expect(launched()).toMatch(freshClaude)
  })

  it('appends --resume for a Claude session id, and only for a valid uuid', () => {
    const sid = '11111111-2222-3333-4444-555555555555'
    const m = new PtyManager(vi.fn(), vi.fn())
    m.spawn({ ...opts, agent: 'claude', resume: sid })
    expect(launched()).toBe(`${AGENTS.claude.command} --resume ${sid} --model opus\r`)
    expect(m.claudeSession(opts.id)?.id).toBe(sid)

    new PtyManager(vi.fn(), vi.fn()).spawn({ ...opts, agent: 'claude', resume: 'x; rm -rf /' })
    expect(launched()).toMatch(freshClaude)

    const c = new PtyManager(vi.fn(), vi.fn())
    c.spawn({ ...opts, agent: 'codex', resume: sid })
    expect(launched()).toBe(AGENTS.codex.command + '\r')
    expect(c.claudeSession(opts.id)).toBeUndefined()
  })
})
