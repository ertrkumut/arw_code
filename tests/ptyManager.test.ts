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
