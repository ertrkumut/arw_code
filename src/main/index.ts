import { app, Menu } from 'electron'
import { registerIpc } from './ipc'
import { StatusBridge } from './statusBridge'
import { IPC } from '@shared/constants'
import { installHooks } from './hookInstaller'
import { WindowManager } from './windows'

// The installed .exe and this dev build otherwise share one userData dir — and therefore
// one single-instance lock — so launching the dev build while the installed app is open
// made the dev process fail the lock and quit instantly. Give dev its own userData
// (separate lock + separate saved projects) so both can run side by side. Must run before
// requestSingleInstanceLock() below.
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
  app.setName('ARWCode Dev')
}

const wm = new WindowManager()

// Hold a single-instance lock. Two processes contending for Electron's GPU/disk
// cache directory is the usual source of the "Unable to move the cache" /
// "Gpu Cache Creation failed" console errors on Windows. A second launch focuses
// the existing window and quits instead of fighting over the cache.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {

app.on('second-instance', () => {
  const main = wm.getMain()
  if (!main) return
  if (main.isMinimized()) main.restore()
  main.focus()
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  try { installHooks() } catch (e) { console.error('[arw] installHooks failed:', e) }
  const bridge = new StatusBridge((e) => wm.broadcast(IPC.statusUpdate, e))
  await bridge.start()
  const mgr = registerIpc(wm, () => bridge.url())
  app.on('before-quit', () => { mgr.killAll(); bridge.stop() })
  wm.createMain()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

}
