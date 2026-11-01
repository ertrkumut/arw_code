import { ipcMain, dialog, clipboard, shell, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { IPC } from '@shared/constants'
import { PtyManager } from './ptyManager'
import { loadState, saveStateDebounced } from './store'
import { listSessions, deleteSession, sessionImages } from './claudeHistory'
import { readDir, TreeWatcher, readTextFile, writeTextFile, listFiles } from './fileTree'
import { getIdeState, patchIdeState, openTabPatch, type IdePatch } from './ideState'
import { DapSession, findMonoDbg } from './debugAdapter'
import { BrowserWindow } from 'electron'
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

  ipcMain.on(IPC.ptySpawn, (_e, { id, cwd, cols, rows, agent, resume }) =>
    mgr.spawn({ id, cwd, cols, rows, agent, resume, eventUrl: eventUrl() }))
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
  ipcMain.handle(IPC.clipboardReadImage, () => {
    const img = clipboard.readImage()
    return img.isEmpty() ? null : img.toDataURL()
  })
  ipcMain.handle(IPC.clipboardWriteImage, (_e, dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
  })

  // Open a project folder in the OS file manager (Explorer/Finder/etc).
  ipcMain.on(IPC.openPath, (_e, p: string) => { void shell.openPath(p) })

  // Claude Code conversation history for a project folder (~/.claude/projects/<folder>).
  ipcMain.handle(IPC.historyList, (_e, projectPath: string) => listSessions(projectPath))
  ipcMain.handle(IPC.historyDelete, (_e, p: { projectPath: string; id: string }) =>
    deleteSession(p.projectPath, p.id))
  ipcMain.handle(IPC.historyImages, (_e, termId: string) => {
    const s = mgr.claudeSession(termId)
    return s ? sessionImages(s.cwd, s.id) : []
  })

  // File explorer: lazy one-level listings + a live watcher on the open project root.
  const tree = new TreeWatcher((root, dirs) => send(IPC.fsChanged, { root, dirs }))
  ipcMain.handle(IPC.fsReadDir, (_e, dir: string) => readDir(dir))
  ipcMain.on(IPC.fsWatch, (_e, root: string) => tree.watch(root))
  ipcMain.on(IPC.fsUnwatch, (_e, root: string) => tree.unwatch(root))
  ipcMain.on(IPC.revealPath, (_e, p: string) => shell.showItemInFolder(p))

  // Editor
  ipcMain.handle(IPC.fsReadFile, (_e, p: string) => readTextFile(p))
  ipcMain.handle(IPC.fsListFiles, (_e, root: string) => listFiles(root))
  ipcMain.handle(IPC.fsWriteFile, (_e, a: { path: string; content: string; bom: boolean }) =>
    writeTextFile(a.path, a.content, a.bom))
  // IDE state: main holds the one copy; windows send patches, everyone else hears about them.
  // Same normalization as the renderer's fileKey (ide/paths.ts) on Windows.
  const fileKey = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const applyPatch = (patch: IdePatch, except?: Electron.WebContents) => {
    patchIdeState(patch)
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && w.webContents !== except) w.webContents.send(IPC.ideChanged, patch)
    }
  }
  ipcMain.handle(IPC.ideLoad, () => getIdeState())
  ipcMain.on(IPC.idePatch, (e, patch: IdePatch) => applyPatch(patch, e.sender))
  // Main window double-clicked a file: add it to the project's tabs, then open/focus its IDE window.
  ipcMain.on(IPC.ideOpen, (_e, p: { projectId: string; name: string; path: string; file?: string }) => {
    if (p.file) applyPatch(openTabPatch(getIdeState(), p.projectId, p.file, fileKey))
    wm.openIde({ projectId: p.projectId, name: p.name, path: p.path })
  })
  ipcMain.on(IPC.setTitleBarColors, (e, c: { color: string; symbolColor: string; bg: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    try { win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: 40 }) } catch { /* no overlay on this platform */ }
    win.setBackgroundColor(c.bg)
  })

  // Unity debugger — one Debug Adapter Protocol session at a time. The renderer drives
  // the protocol (attach, breakpoints, stepping); main only owns the adapter process.
  let dap: DapSession | null = null
  let owner: Electron.WebContents | null = null       // the IDE window that started the session
  const toOwner = (ch: string, payload: unknown) => { if (owner && !owner.isDestroyed()) owner.send(ch, payload) }
  ipcMain.handle(IPC.debugStart, async (e) => {
    if (dap && owner && owner !== e.sender && !owner.isDestroyed()) {
      throw new Error('Another IDE window is already debugging. Stop that session first.')
    }
    dap?.kill()
    owner = e.sender
    // Closing that window ends the session (Unity keeps running).
    e.sender.once('destroyed', () => {
      if (owner !== e.sender) return
      const s = dap
      s?.request('disconnect', { terminateDebuggee: false }, 2000).catch(() => {}).finally(() => s.kill())
    })
    const adapter = findMonoDbg()
    if (!adapter) throw new Error('Unity debugger not found. Install the "DotRush" extension in VS Code / Antigravity (it ships the Mono debug adapter), or set ARW_MONODBG to monodbg.exe.')
    const s = new DapSession(adapter,
      (event, body) => toOwner(IPC.debugEvent, { event, body }),
      (code, stderr) => { if (dap === s) dap = null; toOwner(IPC.debugExit, { code, stderr }) })
    dap = s
    return s.request('initialize', {
      clientID: 'arwcode', clientName: 'ARWCode', adapterID: 'unity', locale: 'en',
      linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path',
      supportsVariableType: true, supportsVariablePaging: false, supportsRunInTerminalRequest: false
    })
  })
  ipcMain.handle(IPC.debugRequest, (_e, a: { command: string; args?: unknown }) => {
    if (!dap) throw new Error('No debug session')
    return dap.request(a.command, a.args)
  })
  ipcMain.on(IPC.debugStop, () => {
    const s = dap
    if (!s) return
    s.request('disconnect', { terminateDebuggee: false }, 3000).catch(() => {}).finally(() => setTimeout(() => s.kill(), 300))
  })

  return mgr
}
