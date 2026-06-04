import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'

const api = {
  spawn: (id: string, cwd: string, cols: number, rows: number) =>
    ipcRenderer.send(IPC.ptySpawn, { id, cwd, cols, rows }),
  input: (id: string, data: string) => ipcRenderer.send(IPC.ptyInput, { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send(IPC.ptyResize, { id, cols, rows }),
  kill: (id: string) => ipcRenderer.send(IPC.ptyKill, { id }),
  onData: (cb: (p: { id: string; data: string }) => void) =>
    ipcRenderer.on(IPC.ptyData, (_e, p) => cb(p)),
  onExit: (cb: (p: { id: string; code: number }) => void) =>
    ipcRenderer.on(IPC.ptyExit, (_e, p) => cb(p)),
  onStatus: (cb: (p: { id: string; state: string }) => void) =>
    ipcRenderer.on(IPC.statusUpdate, (_e, p) => cb(p))
}

contextBridge.exposeInMainWorld('arw', api)
export type ArwApi = typeof api
