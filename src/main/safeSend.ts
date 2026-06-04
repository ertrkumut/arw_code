import { BrowserWindow } from 'electron'

/**
 * Send to the renderer only if the target is still alive.
 *
 * pty `onData` (and StatusBridge events) can fire while the app is tearing
 * down: the OS pty pipe may deliver buffered bytes *after* the BrowserWindow's
 * webContents has been destroyed. Calling `webContents.send()` on a destroyed
 * target throws "Object has been destroyed". A plain `win?.` null check is not
 * enough — `win` can be a non-null reference to an already-destroyed window —
 * so we must check isDestroyed() on both the window and its webContents.
 *
 * Returns true if the message was sent.
 */
export function safeSend(
  win: BrowserWindow | null,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false
  win.webContents.send(channel, ...args)
  return true
}
