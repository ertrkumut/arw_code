import { BrowserWindow } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/constants'

const PRELOAD = () => join(__dirname, '../preload/index.js')
const RENDERER_FILE = () => join(__dirname, '../renderer/index.html')

const baseWindowOpts = {
  backgroundColor: '#0E1016',
  titleBarStyle: 'hidden' as const,
  titleBarOverlay: { color: '#13151D', symbolColor: '#A6ADC0', height: 40 }
}

/**
 * Owns every BrowserWindow: the main grid window plus one child window per
 * torn-off terminal. PTYs live in the main process keyed by terminal id, so a
 * terminal can move between windows freely — this class only manages *views*.
 */
export class WindowManager {
  private main: BrowserWindow | null = null
  private children = new Map<string, BrowserWindow>()   // termId -> torn-off window
  private reattaching = new Set<string>()               // termIds closing to return to the grid (don't kill)

  /** Kill a terminal's shell. Set by registerIpc once the PtyManager exists. */
  onKill: (termId: string) => void = () => {}

  createMain(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1280, height: 800, title: 'ARWCode',
      webPreferences: { preload: PRELOAD() },
      ...baseWindowOpts
    })
    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else win.loadFile(RENDERER_FILE())
    win.on('closed', () => { this.main = null })
    this.main = win
    return win
  }

  getMain(): BrowserWindow | null {
    return this.main && !this.main.isDestroyed() ? this.main : null
  }

  /** Send to every live window. Renderers ignore ids they don't own. */
  broadcast(channel: string, ...args: unknown[]): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, ...args)
    }
  }

  /** Pop a terminal into its own window near where it was dropped. */
  tearOff(p: { termId: string; name: string; color?: string; cwd: string; screenX: number; screenY: number }): void {
    const existing = this.children.get(p.termId)
    if (existing && !existing.isDestroyed()) { existing.focus(); return }

    const win = new BrowserWindow({
      width: 760, height: 520,
      x: Math.round(p.screenX - 140), y: Math.round(p.screenY - 18),
      title: p.name,
      webPreferences: { preload: PRELOAD() },
      ...baseWindowOpts
    })
    const search = `?term=${encodeURIComponent(p.termId)}`
      + `&name=${encodeURIComponent(p.name)}`
      + (p.color ? `&color=${encodeURIComponent(p.color)}` : '')
      + `&cwd=${encodeURIComponent(p.cwd)}`
    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL + search)
    else win.loadFile(RENDERER_FILE(), { search })

    this.children.set(p.termId, win)
    win.on('closed', () => {
      this.children.delete(p.termId)
      if (this.reattaching.delete(p.termId)) return        // returned to grid — keep the shell alive
      this.onKill(p.termId)                                 // user closed the window — kill the shell
      this.broadcast(IPC.terminalClosed, { id: p.termId })  // and drop the tile from the grid
    })
  }

  /** Return a torn-off terminal to the grid if it was released over the main window. */
  reattach(p: { termId: string; screenX: number; screenY: number }): void {
    const child = this.children.get(p.termId)
    const main = this.getMain()
    if (!child || child.isDestroyed() || !main) return
    const b = main.getBounds()
    const inside = p.screenX >= b.x && p.screenX <= b.x + b.width
      && p.screenY >= b.y && p.screenY <= b.y + b.height
    if (!inside) return                                     // dropped elsewhere — stays detached
    this.reattaching.add(p.termId)
    this.broadcast(IPC.terminalReattached, { id: p.termId })
    main.focus()
    child.close()
  }
}
