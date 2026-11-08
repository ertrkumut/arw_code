import { app, BrowserWindow, Menu } from 'electron'
import { execFileSync } from 'child_process'
import { registerIpc } from './ipc'
import { StatusBridge } from './statusBridge'
import { noteSession } from './chatManager'
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

// macOS apps launched from Finder/Dock get a bare PATH (/usr/bin:/bin:...), so `claude`
// (Homebrew / npm global / ~/.local/bin) isn't found. Borrow PATH from the user's login shell.
if (process.platform === 'darwin') {
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__ARWPATH__%s__ARWPATH__" "$PATH"'], { encoding: 'utf8', timeout: 5000 })
    const m = /__ARWPATH__(.*?)__ARWPATH__/.exec(out)
    if (m?.[1]) process.env.PATH = m[1]
  } catch (e) { console.error('[arw] login-shell PATH lookup failed:', e) }
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
  // macOS needs an app menu or Cmd+C / Cmd+V / Cmd+Q stop working.
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    : null)
  try { installHooks() } catch (e) { console.error('[arw] installHooks failed:', e) }
  const bridge = new StatusBridge((e) => {
    if (e.sessionId) noteSession(e.id, e.sessionId)
    if (e.state) wm.broadcast(IPC.statusUpdate, e)
  })
  await bridge.start()
  const mgr = registerIpc(wm, () => bridge.url())
  app.on('before-quit', () => { mgr.killAll(); bridge.stop() })
  wm.createMain()
  // macOS: clicking the Dock icon with no windows open reopens the main window.
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) wm.createMain() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

}
