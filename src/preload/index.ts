import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { IPC } from '../shared/constants'

const api = {
  spawn: (id: string, cwd: string, cols: number, rows: number) =>
    ipcRenderer.send(IPC.ptySpawn, { id, cwd, cols, rows }),
  input: (id: string, data: string) => ipcRenderer.send(IPC.ptyInput, { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send(IPC.ptyResize, { id, cols, rows }),
  kill: (id: string) => ipcRenderer.send(IPC.ptyKill, { id }),
  onData: (cb: (p: { id: string; data: string }) => void) => {
    const h = (_e: IpcRendererEvent, p: { id: string; data: string }) => cb(p)
    ipcRenderer.on(IPC.ptyData, h)
    return () => ipcRenderer.removeListener(IPC.ptyData, h)
  },
  onExit: (cb: (p: { id: string; code: number }) => void) => {
    const h = (_e: IpcRendererEvent, p: { id: string; code: number }) => cb(p)
    ipcRenderer.on(IPC.ptyExit, h)
    return () => ipcRenderer.removeListener(IPC.ptyExit, h)
  },
  onStatus: (cb: (p: { id: string; state: string }) => void) => {
    const h = (_e: IpcRendererEvent, p: { id: string; state: string }) => cb(p)
    ipcRenderer.on(IPC.statusUpdate, h)
    return () => ipcRenderer.removeListener(IPC.statusUpdate, h)
  }
}

contextBridge.exposeInMainWorld('arw', api)
export type ArwApi = typeof api
