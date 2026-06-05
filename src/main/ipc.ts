import { ipcMain, dialog, clipboard, shell } from 'electron'
import { existsSync } from 'fs'
import { IPC } from '@shared/constants'
import { PtyManager } from './ptyManager'
import { loadState, saveStateDebounced } from './store'
import type { WindowManager } from './windows'

export function registerIpc(wm: WindowManager, eventUrl: () => string) {
  const send = (ch: string, ...args: unknown[]) => wm.broadcast(ch, ...args)
  const mgr = new PtyManager(
    (id, data) => send(IPC.ptyData, { id, data }),
    (id, code) => {
      send(IPC.ptyExit, { id, code })
      if (code !== 0) send(IPC.statusUpdate, { id, state: 'error' })
    },
    (id, message) => send(IPC.ptyError, { id, message })
  )
  wm.onKill = (id) => mgr.kill(id)   // a torn-off window closing kills its shell

  ipcMain.on(IPC.ptySpawn, (_e, { id, cwd, cols, rows }) =>
    mgr.spawn({ id, cwd, cols, rows, eventUrl: eventUrl() }))
  ipcMain.on(IPC.ptyInput, (_e, { id, data }) => mgr.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, { id, cols, rows }) => mgr.resize(id, cols, rows))
  ipcMain.on(IPC.ptyKill, (_e, { id }) => mgr.kill(id))

  ipcMain.on(IPC.terminalTearOff, (_e, p) => wm.tearOff(p))
  ipcMain.on(IPC.terminalReattach, (_e, p) => wm.reattach(p))

  ipcMain.handle(IPC.storeLoad, () => loadState())
  ipcMain.on(IPC.storeSave, (_e, state) => saveStateDebounced(state))
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.fsExists, (_e, p: string) => existsSync(p))

  // Clipboard via the main process: navigator.clipboard.readText() is blocked in
  // the file:// renderer (non-secure context), so route copy/paste through Electron.
  ipcMain.handle(IPC.clipboardRead, () => clipboard.readText())
  ipcMain.on(IPC.clipboardWrite, (_e, text: string) => clipboard.writeText(text))

  // Open a project folder in the OS file manager (Explorer/Finder/etc).
  ipcMain.on(IPC.openPath, (_e, p: string) => { void shell.openPath(p) })

  return mgr
}
