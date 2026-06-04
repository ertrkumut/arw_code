import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IPC } from '@shared/constants'
import { PtyManager } from './ptyManager'
import { loadState, saveStateDebounced } from './store'

export function registerIpc(getWin: () => BrowserWindow | null, eventUrl: () => string) {
  const send = (ch: string, ...args: unknown[]) => getWin()?.webContents.send(ch, ...args)
  const mgr = new PtyManager(
    (id, data) => send(IPC.ptyData, { id, data }),
    (id, code) => {
      send(IPC.ptyExit, { id, code })
      if (code !== 0) send(IPC.statusUpdate, { id, state: 'error' })
    },
    (id, state) => send(IPC.statusUpdate, { id, state })
  )

  ipcMain.on(IPC.ptySpawn, (_e, { id, cwd, cols, rows }) =>
    mgr.spawn({ id, cwd, cols, rows, eventUrl: eventUrl() }))
  ipcMain.on(IPC.ptyInput, (_e, { id, data }) => mgr.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, { id, cols, rows }) => mgr.resize(id, cols, rows))
  ipcMain.on(IPC.ptyKill, (_e, { id }) => mgr.kill(id))

  ipcMain.handle(IPC.storeLoad, () => loadState())
  ipcMain.on(IPC.storeSave, (_e, state) => saveStateDebounced(state))
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  return mgr
}
