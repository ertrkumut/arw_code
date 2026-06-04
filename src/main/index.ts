import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { StatusBridge } from './statusBridge'
import { IPC } from '@shared/constants'
import { installHooks } from './hookInstaller'

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#0E1016', title: 'ARWCode',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#13151D', symbolColor: '#A6ADC0', height: 40 },
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  try { installHooks() } catch (e) { console.error('[arw] installHooks failed:', e) }
  const bridge = new StatusBridge((e) => win?.webContents.send(IPC.statusUpdate, e))
  await bridge.start()
  const mgr = registerIpc(() => win, () => bridge.url())
  app.on('before-quit', () => { mgr.killAll(); bridge.stop() })
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
