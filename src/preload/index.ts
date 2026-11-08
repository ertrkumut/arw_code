import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { IPC } from '../shared/constants'
import type { AgentId } from '../shared/agents'
import type { ClaudeSession } from '../main/claudeHistory'
import type { DirEntry, TextFile } from '../main/fileTree'
import type { IdePatch } from '../main/ideState'
import type { AgentEdit } from '../shared/agentEdits'
import type { IndexStatus } from '../main/codeIndex'
import type { FindOptions, FindResult } from '../main/findInFiles'

const api = {
  spawn: (id: string, cwd: string, cols: number, rows: number, agent?: AgentId, resume?: string, sessionId?: string) =>
    ipcRenderer.send(IPC.ptySpawn, { id, cwd, cols, rows, agent, resume, sessionId }),
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
  /** 5-hour plan usage cached by the Claude status line (pct 0-100, reset epoch s, ts epoch ms). */
  usageCache: (): Promise<{ pct: number; resetsAt: number; ts: number } | null> => ipcRenderer.invoke(IPC.usageCache),
  clipboardReadImage: (): Promise<string | null> => ipcRenderer.invoke(IPC.clipboardReadImage),
  clipboardWriteImage: (dataUrl: string): Promise<void> => ipcRenderer.invoke(IPC.clipboardWriteImage, dataUrl),
  openInExplorer: (path: string) => ipcRenderer.send(IPC.openPath, path),
  openExternal: (url: string) => ipcRenderer.send(IPC.openExternal, url),
  revealInExplorer: (path: string) => ipcRenderer.send(IPC.revealPath, path),
  fs: {
    readDir: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke(IPC.fsReadDir, dir),
    listFiles: (root: string): Promise<string[]> => ipcRenderer.invoke(IPC.fsListFiles, root),
    readFile: (path: string): Promise<TextFile> => ipcRenderer.invoke(IPC.fsReadFile, path),
    writeFile: (path: string, content: string, bom: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.fsWriteFile, { path, content, bom }),
    watch: (root: string) => ipcRenderer.send(IPC.fsWatch, root),
    unwatch: (root: string) => ipcRenderer.send(IPC.fsUnwatch, root),
    onChanged: (cb: (p: { root: string; dirs: string[] }) => void) => {
      const h = (_e: IpcRendererEvent, p: { root: string; dirs: string[] }) => cb(p)
      ipcRenderer.on(IPC.fsChanged, h)
      return () => ipcRenderer.removeListener(IPC.fsChanged, h)
    },
  },
  ide: {
    load: (): Promise<unknown> => ipcRenderer.invoke(IPC.ideLoad),
    patch: (patch: IdePatch) => ipcRenderer.send(IPC.idePatch, patch),
    onChanged: (cb: (patch: IdePatch) => void) => {
      const h = (_e: IpcRendererEvent, p: IdePatch) => cb(p)
      ipcRenderer.on(IPC.ideChanged, h)
      return () => ipcRenderer.removeListener(IPC.ideChanged, h)
    },
    /** Open (or focus) the project's IDE window, optionally opening a file in it. */
    open: (p: { projectId: string; name: string; path: string; file?: string; line?: number }) => ipcRenderer.send(IPC.ideOpen, p),
    /** The main window asked this IDE window to show a line (e.g. clicked one of Claude's edits). */
    onReveal: (cb: (p: { file: string; line: number }) => void) => {
      const h = (_e: IpcRendererEvent, p: { file: string; line: number }) => cb(p)
      ipcRenderer.on(IPC.ideReveal, h)
      return () => ipcRenderer.removeListener(IPC.ideReveal, h)
    },
    takeReveal: (projectId: string): Promise<{ file: string; line: number } | null> => ipcRenderer.invoke(IPC.ideTakeReveal, projectId),
    setTitleBarColors: (c: { color: string; symbolColor: string; bg: string }) => ipcRenderer.send(IPC.setTitleBarColors, c),
  },
  /** C# code insight backed by the project index in main (see src/main/codeIndex.ts). */
  code: {
    query: <T = any>(root: string, op: string, args?: unknown): Promise<T> => ipcRenderer.invoke(IPC.codeQuery, { root, op, args }),
    update: (root: string, path: string, text: string | null) => ipcRenderer.send(IPC.codeUpdate, { root, path, text }),
    onEvent: (cb: (p: { root: string; ev: 'progress' | 'changed'; status: IndexStatus }) => void) => {
      const h = (_e: IpcRendererEvent, p: { root: string; ev: 'progress' | 'changed'; status: IndexStatus }) => cb(p)
      ipcRenderer.on(IPC.codeEvent, h)
      return () => ipcRenderer.removeListener(IPC.codeEvent, h)
    },
    findInFiles: (root: string, options: FindOptions): Promise<FindResult> => ipcRenderer.invoke(IPC.findInFiles, { root, options }),
  },
  debug: {
    /** Spawn the adapter and send `initialize`; resolves with its capabilities. */
    start: (): Promise<any> => ipcRenderer.invoke(IPC.debugStart),
    request: (command: string, args?: unknown): Promise<any> => ipcRenderer.invoke(IPC.debugRequest, { command, args }),
    stop: () => ipcRenderer.send(IPC.debugStop),
    onEvent: (cb: (p: { event: string; body: any }) => void) => {
      const h = (_e: IpcRendererEvent, p: { event: string; body: any }) => cb(p)
      ipcRenderer.on(IPC.debugEvent, h)
      return () => ipcRenderer.removeListener(IPC.debugEvent, h)
    },
    onExit: (cb: (p: { code: number | null; stderr: string }) => void) => {
      const h = (_e: IpcRendererEvent, p: { code: number | null; stderr: string }) => cb(p)
      ipcRenderer.on(IPC.debugExit, h)
      return () => ipcRenderer.removeListener(IPC.debugExit, h)
    },
  },
  chat: {
    open: (id: string, cwd: string, resume?: string): Promise<{ sessionId: string; transcript: string }> =>
      ipcRenderer.invoke(IPC.chatOpen, { id, cwd, resume }),
    send: (id: string, content: unknown[], echo: { text: string; images: string[] }) =>
      ipcRenderer.send(IPC.chatSend, { id, content, echo }),
    interrupt: (id: string) => ipcRenderer.send(IPC.chatInterrupt, id),
    reset: (id: string): Promise<{ sessionId: string } | null> => ipcRenderer.invoke(IPC.chatReset, id),
    control: (id: string, subtype: string, extra?: Record<string, unknown>): Promise<any> =>
      ipcRenderer.invoke(IPC.chatControl, { id, subtype, extra }),
    switchSession: (id: string, sessionId: string): Promise<{ sessionId: string; transcript: string } | null> =>
      ipcRenderer.invoke(IPC.chatSwitch, { id, sessionId }),
    suspend: (id: string): Promise<{ sessionId: string; resume: boolean } | null> => ipcRenderer.invoke(IPC.chatSuspend, id),
    returnFromTerminal: (id: string): Promise<{ sessionId: string; transcript: string } | null> => ipcRenderer.invoke(IPC.chatReturn, id),
    onEvent: (cb: (p: { id: string; event: any }) => void) => {
      const h = (_e: IpcRendererEvent, p: { id: string; event: any }) => cb(p)
      ipcRenderer.on(IPC.chatEvent, h)
      return () => ipcRenderer.removeListener(IPC.chatEvent, h)
    },
  },
  /** Claude's unreviewed file edits (see shared/agentEdits.ts). */
  edits: {
    list: (): Promise<AgentEdit[]> => ipcRenderer.invoke(IPC.editsList),
    set: (path: string, baseline: string | null) => ipcRenderer.send(IPC.editsSet, { path, baseline }),
    onChanged: (cb: (p: { path: string; edit: AgentEdit | null }) => void) => {
      const h = (_e: IpcRendererEvent, p: { path: string; edit: AgentEdit | null }) => cb(p)
      ipcRenderer.on(IPC.editsChanged, h)
      return () => ipcRenderer.removeListener(IPC.editsChanged, h)
    },
  },
  history: {
    list: (projectPath: string): Promise<ClaudeSession[]> =>
      ipcRenderer.invoke(IPC.historyList, projectPath),
    remove: (projectPath: string, id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.historyDelete, { projectPath, id }),
    /** Images sent in this terminal's Claude conversation (data URLs, oldest first). */
    images: (termId: string): Promise<string[]> => ipcRenderer.invoke(IPC.historyImages, termId),
  },
}

contextBridge.exposeInMainWorld('arw', api)
export type ArwApi = typeof api
