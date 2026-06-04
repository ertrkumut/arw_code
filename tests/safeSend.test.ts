import { describe, it, expect, vi } from 'vitest'
import { safeSend } from '@main/safeSend'
import type { BrowserWindow } from 'electron'

// Duck-typed stand-in for a BrowserWindow — safeSend only touches
// isDestroyed() and webContents.{isDestroyed,send}.
function fakeWin(opts: { winDestroyed?: boolean; wcDestroyed?: boolean }) {
  const send = vi.fn()
  const win = {
    isDestroyed: () => !!opts.winDestroyed,
    webContents: { isDestroyed: () => !!opts.wcDestroyed, send }
  } as unknown as BrowserWindow
  return { win, send }
}

describe('safeSend', () => {
  it('sends when the window and webContents are both alive', () => {
    const { win, send } = fakeWin({})
    expect(safeSend(win, 'pty:data', { id: 'a', data: 'x' })).toBe(true)
    expect(send).toHaveBeenCalledWith('pty:data', { id: 'a', data: 'x' })
  })

  it('does not send (and does not throw) when win is null', () => {
    expect(() => safeSend(null, 'pty:data', {})).not.toThrow()
    expect(safeSend(null, 'pty:data', {})).toBe(false)
  })

  it('does not send when the window has been destroyed', () => {
    const { win, send } = fakeWin({ winDestroyed: true })
    expect(safeSend(win, 'pty:data', {})).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('does not send when the webContents has been destroyed (the close-race case)', () => {
    const { win, send } = fakeWin({ wcDestroyed: true })
    expect(safeSend(win, 'pty:data', {})).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
