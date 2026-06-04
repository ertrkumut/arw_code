import { describe, it, expect, afterEach } from 'vitest'
import { StatusBridge } from '@main/statusBridge'

let bridge: StatusBridge
afterEach(() => bridge?.stop())

describe('StatusBridge', () => {
  it('starts on a free port and reports its url', async () => {
    bridge = new StatusBridge(() => {})
    await bridge.start()
    expect(bridge.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/event$/)
  })

  it('invokes callback with posted event', async () => {
    const events: unknown[] = []
    bridge = new StatusBridge((e) => events.push(e))
    await bridge.start()
    await fetch(bridge.url(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'term-7', state: 'needs-you' })
    })
    await new Promise(r => setTimeout(r, 50))
    expect(events).toEqual([{ id: 'term-7', state: 'needs-you' }])
  })
})
