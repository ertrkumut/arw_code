import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#0F111A',
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  registerIpc(() => win, () => 'http://127.0.0.1:0/event')
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
