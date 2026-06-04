import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/constants'
import { PtyManager } from './ptyManager'

export function registerIpc(getWin: () => BrowserWindow | null, eventUrl: () => string) {
  const send = (ch: string, ...args: unknown[]) => getWin()?.webContents.send(ch, ...args)
  const mgr = new PtyManager(
    (id, data) => send(IPC.ptyData, { id, data }),
    (id, code) => send(IPC.ptyExit, { id, code })
  )

  ipcMain.on(IPC.ptySpawn, (_e, { id, cwd, cols, rows }) =>
    mgr.spawn({ id, cwd, cols, rows, eventUrl: eventUrl() }))
  ipcMain.on(IPC.ptyInput, (_e, { id, data }) => mgr.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, { id, cols, rows }) => mgr.resize(id, cols, rows))
  ipcMain.on(IPC.ptyKill, (_e, { id }) => mgr.kill(id))

  return mgr
}
