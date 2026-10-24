import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { IPC } from '../shared/constants'
import type { AgentId } from '../shared/agents'
import type { ClaudeSession } from '../main/claudeHistory'

const api = {
  spawn: (id: string, cwd: string, cols: number, rows: number, agent?: AgentId, resume?: string) =>
    ipcRenderer.send(IPC.ptySpawn, { id, cwd, cols, rows, agent, resume }),
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
  },
  onError: (cb: (p: { id: string; message: string }) => void) => {
    const h = (_e: IpcRendererEvent, p: { id: string; message: string }) => cb(p)
    ipcRenderer.on(IPC.ptyError, h)
    return () => ipcRenderer.removeListener(IPC.ptyError, h)
  },
  tearOff: (p: { projectId: string; termId: string; name: string; color?: string; cwd: string; agent?: AgentId; screenX: number; screenY: number }) =>
    ipcRenderer.send(IPC.terminalTearOff, p),
  reattach: (p: { termId: string; screenX: number; screenY: number }) =>
    ipcRenderer.send(IPC.terminalReattach, p),
  onReattached: (cb: (p: { id: string }) => void) => {
    const h = (_e: IpcRendererEvent, p: { id: string }) => cb(p)
    ipcRenderer.on(IPC.terminalReattached, h)
    return () => ipcRenderer.removeListener(IPC.terminalReattached, h)
  },
  onClosed: (cb: (p: { id: string }) => void) => {
    const h = (_e: IpcRendererEvent, p: { id: string }) => cb(p)
    ipcRenderer.on(IPC.terminalClosed, h)
    return () => ipcRenderer.removeListener(IPC.terminalClosed, h)
  },
  pathExists: (p: string): Promise<boolean> => ipcRenderer.invoke(IPC.fsExists, p),
  loadStore: () => ipcRenderer.invoke(IPC.storeLoad),
  saveStore: (state: unknown) => ipcRenderer.send(IPC.storeSave, state),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickFolder),
  clipboardRead: (): Promise<string> => ipcRenderer.invoke(IPC.clipboardRead),
  clipboardWrite: (text: string) => ipcRenderer.send(IPC.clipboardWrite, text),
  clipboardReadImage: (): Promise<string | null> => ipcRenderer.invoke(IPC.clipboardReadImage),
  openInExplorer: (path: string) => ipcRenderer.send(IPC.openPath, path),
  history: {
    list: (projectPath: string): Promise<ClaudeSession[]> =>
      ipcRenderer.invoke(IPC.historyList, projectPath),
    remove: (projectPath: string, id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.historyDelete, { projectPath, id }),
  },
}

contextBridge.exposeInMainWorld('arw', api)
export type ArwApi = typeof api
