import { ipcMain, dialog, clipboard, shell, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { IPC } from '@shared/constants'
import { PtyManager } from './ptyManager'
import { loadState, saveStateDebounced } from './store'
import { listSessions, deleteSession, sessionImages } from './claudeHistory'
import { readDir, TreeWatcher, readTextFile, writeTextFile, listFiles } from './fileTree'
import { getIdeState, patchIdeState, openTabPatch, type IdePatch } from './ideState'
import { DapSession, findMonoDbg } from './debugAdapter'
import { BrowserWindow } from 'electron'
import type { WindowManager } from './windows'
import { ChatManager, readTranscript, takeReportedSession, type ContentBlock } from './chatManager'
import { CodexChatManager, readCodexTranscript } from './codexChat'
import { app } from 'electron'
import { AgentEditTracker } from './agentEdits'
import { getIndex } from './codeIndex'
import { findInFiles, type FindOptions } from './findInFiles'

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
  // Claude panes are chats: a headless Claude process per pane (see chatManager.ts).
  // Claude's file edits, kept for review in the IDE (see agentEdits.ts).
  const edits = new AgentEditTracker((path, edit) => send(IPC.editsChanged, { path, edit }))
  ipcMain.handle(IPC.editsList, () => edits.list())
  ipcMain.on(IPC.editsSet, (_e, p: { path: string; baseline: string | null }) => edits.set(p.path, p.baseline))
  const claudeChat = new ChatManager((id, event) => { send(IPC.chatEvent, { id, event }); edits.noteEvent(event) }, eventUrl)
  // Codex panes are chats too, one `codex exec` per prompt (see codexChat.ts).
  const codexChat = new CodexChatManager((id, event) => send(IPC.chatEvent, { id, event }))
  const chatOf = (id: string) => (codexChat.has(id) ? codexChat : claudeChat)
  const transcriptOf = (id: string, cwd: string, sessionId: string) =>
    codexChat.has(id) ? readCodexTranscript(sessionId) : readTranscript(cwd, sessionId)
  const chat = {
    session: (id: string) => chatOf(id).session(id),
    kill: (id: string) => { claudeChat.kill(id); codexChat.kill(id) }
  }
  app.on('before-quit', () => { claudeChat.killAll(); codexChat.killAll() })
  ipcMain.handle(IPC.chatOpen, async (_e, p: { id: string; cwd: string; resume?: string; agent?: string }) => {
    const { sessionId } = (p.agent === 'codex' ? codexChat : claudeChat).open(p.id, p.cwd, p.resume)
    // Always read: a torn-off window re-opening a running chat needs the history too.
    return { sessionId, transcript: await transcriptOf(p.id, p.cwd, sessionId) }
  })
  ipcMain.on(IPC.chatSend, (_e, p: { id: string; content: ContentBlock[]; echo: { text: string; images: string[] } }) =>
    chatOf(p.id).send(p.id, p.content, p.echo))
  ipcMain.on(IPC.chatInterrupt, (_e, id: string) => chatOf(id).interrupt(id))
  ipcMain.handle(IPC.chatReset, (_e, id: string) => chatOf(id).reset(id))
  ipcMain.handle(IPC.chatControl, (_e, p: { id: string; subtype: string; extra?: Record<string, unknown> }) =>
    codexChat.has(p.id) ? codexChat.control(p.id, p.subtype, p.extra ?? {}) :claudeChat.control(p.id, p.subtype, p.extra ?? {}))
  ipcMain.handle(IPC.chatSwitch, async (_e, p: { id: string; sessionId: string }) => {
    if (codexChat.has(p.id)) return null
    const r = claudeChat.switchSession(p.id, p.sessionId)
    return r ? { sessionId: r.sessionId, transcript: await readTranscript(r.cwd, r.sessionId) } : null
  })
  ipcMain.handle(IPC.chatSuspend, (_e, id: string) => chatOf(id).suspend(id))
  ipcMain.handle(IPC.chatReturn, async (_e, id: string) => {
    mgr.kill(`${id}:tui`)                       // the terminal-mode pty of this pane
    const r = codexChat.has(id) ? codexChat.resumeAfterTerminal(id) : claudeChat.resumeAfterTerminal(id, takeReportedSession(`${id}:tui`))
    return r ? { sessionId: r.sessionId, transcript: await transcriptOf(id, r.cwd, r.sessionId) } : null
  })

  wm.onKill = (id) => { mgr.kill(id); mgr.kill(`${id}:tui`); chat.kill(id) }   // a torn-off window closing kills its shell / chat

  ipcMain.on(IPC.ptySpawn, (_e, { id, cwd, cols, rows, agent, resume, sessionId }) =>
    // "<pane>:tui" is a chat pane's terminal mode: its shell ends when claude does.
    mgr.spawn({ id, cwd, cols, rows, agent, resume, sessionId, exitWithAgent: String(id).endsWith(':tui'), eventUrl: eventUrl() }))
  ipcMain.on(IPC.ptyInput, (_e, { id, data }) => mgr.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, { id, cols, rows }) => mgr.resize(id, cols, rows))
  ipcMain.on(IPC.ptyKill, (_e, { id }) => { mgr.kill(id); mgr.kill(`${id}:tui`); chat.kill(id) })

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
  // Plan usage the user's Claude status line caches (~/.claude/statusbar_usage_cache.json:
  // { ts, pct, reset_ts }). Lets the chat bar show the 5-hour window before Claude replies.
  ipcMain.handle(IPC.usageCache, async () => {
    try {
      const c = JSON.parse(await readFile(join(homedir(), '.claude', 'statusbar_usage_cache.json'), 'utf8'))
      if (typeof c?.pct !== 'number') return null
      return { pct: c.pct as number, resetsAt: Number(c.reset_ts) || 0, ts: Math.round(Number(c.ts) * 1000) || 0 }
    } catch { return null }
  })

  ipcMain.handle(IPC.clipboardReadImage, () => {
    const img = clipboard.readImage()
    return img.isEmpty() ? null : img.toDataURL()
  })
  ipcMain.handle(IPC.clipboardWriteImage, (_e, dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
  })

  // Open a project folder in the OS file manager (Explorer/Finder/etc).
  ipcMain.on(IPC.openPath, (_e, p: string) => { void shell.openPath(p) })
  ipcMain.on(IPC.openExternal, (_e, url: string) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url) })

  // Claude Code conversation history for a project folder (~/.claude/projects/<folder>).
  ipcMain.handle(IPC.historyList, (_e, projectPath: string) => listSessions(projectPath))
  ipcMain.handle(IPC.historyDelete, (_e, p: { projectPath: string; id: string }) =>
    deleteSession(p.projectPath, p.id))
  ipcMain.handle(IPC.historyImages, (_e, termId: string) => {
    const s = mgr.claudeSession(termId) ?? chat.session(termId)
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
  // A line to jump to waits here until a just-opened IDE window asks for it.
  const pendingReveal = new Map<string, { file: string; line: number }>()
  ipcMain.on(IPC.ideOpen, (_e, p: { projectId: string; name: string; path: string; file?: string; line?: number }) => {
    if (p.file) applyPatch(openTabPatch(getIdeState(), p.projectId, p.file, fileKey))
    const reveal = p.file && p.line ? { file: p.file, line: p.line } : null
    const created = wm.openIde({ projectId: p.projectId, name: p.name, path: p.path })
    if (!reveal) return
    if (created) pendingReveal.set(p.projectId, reveal)
    else wm.ideWindow(p.projectId)?.webContents.send(IPC.ideReveal, reveal)
  })
  ipcMain.handle(IPC.ideTakeReveal, (_e, projectId: string) => {
    const r = pendingReveal.get(projectId)
    pendingReveal.delete(projectId)
    return r ?? null
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

  // C# code insight (Ctrl+Click, Find Usages, completion, Code Vision…) — see codeIndex.ts.
  const index = (root: string) => getIndex(root, (r, ev, status) => send(IPC.codeEvent, { root: r, ev, status }))
  ipcMain.handle(IPC.codeQuery, async (_e, q: { root: string; op: string; args: any }) => {
    const ix = index(q.root)
    const a = q.args ?? {}
    if (q.op === 'status') return ix.status
    await ix.ready()
    switch (q.op) {
      case 'resolve': return ix.resolve(a.path, a.src, a.offset)
      case 'complete': return ix.complete(a.path, a.src, a.offset)
      case 'signature': return ix.signature(a.path, a.src, a.offset)
      case 'inlay': return ix.inlay(a.path, a.src, a.from, a.to)
      case 'lens': return ix.lens(a.path, a.src)
      case 'super': return ix.superOf(a.path, a.src, a.offset)
      case 'typeDecl': return ix.typeDecl(a.path, a.src, a.offset)
      case 'implementations': return ix.implementations(a.target)
      case 'overridable': return ix.overridable(a.path, a.src, a.offset)
      case 'usages': return ix.usages(a.name, a.target ?? null)
      case 'localUsages': return ix.localUsages(a.path, a.src, a.line, a.col, a.name)
      case 'search': return ix.search(a.query ?? '', a.scope ?? 'symbols', a.limit ?? 200)
      case 'namespacesFor': return ix.namespacesFor(a.name)
      case 'fileSymbols': return ix.fileSymbols(a.path)
    }
    throw new Error(`Unknown code query: ${q.op}`)
  })
  ipcMain.on(IPC.codeUpdate, (_e, u: { root: string; path: string; text: string | null }) => { void index(u.root).update(u.path, u.text) })
  ipcMain.handle(IPC.findInFiles, (_e, a: { root: string; options: FindOptions }) => findInFiles(a.root, a.options))

  return mgr
}
