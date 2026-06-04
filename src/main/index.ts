import { app, Menu } from 'electron'
import { registerIpc } from './ipc'
import { StatusBridge } from './statusBridge'
import { IPC } from '@shared/constants'
import { installHooks } from './hookInstaller'
import { WindowManager } from './windows'

const wm = new WindowManager()

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
