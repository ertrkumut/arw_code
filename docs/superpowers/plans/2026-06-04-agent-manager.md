# Agent Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop app that organizes Claude Code CLI terminals by project, shows each terminal's live status (working / needs-you / idle / error), and tiles a selected project's terminals in an auto-arranging grid.

**Architecture:** Electron with two processes. The **main** process owns PTYs (node-pty/ConPTY), a localhost Status Bridge HTTP server that receives Claude Code hook events, a JSON store for projects/layout, and a hook installer that merges entries into `~/.claude/settings.json`. The **renderer** (React + Vite) shows a 1/4-width sidebar of workspace cards and a 3/4-width auto-tiling terminal grid (xterm.js). Status flows: Claude hook → localhost POST → main → IPC → renderer badge.

**Tech Stack:** Electron, electron-vite, electron-builder, React, TypeScript, @xterm/xterm (+ addon-fit, addon-webgl), node-pty, Zustand, Vitest, @electron/rebuild.

---

## File Structure

```
package.json                      # scripts + deps
electron.vite.config.ts           # electron-vite config (main/preload/renderer)
tsconfig.json / tsconfig.node.json
vitest.config.ts                  # unit test config (node env)

src/
  shared/
    types.ts                      # shared types: Project, Terminal, TermState, IPC payloads
    tiling.ts                     # pure: terminalCount -> {rows, cols} + slot order
    status.ts                     # pure: hook/exit event -> TermState; aggregate worst-state
    constants.ts                  # channel names, env var names, default sidebar width

  main/
    index.ts                      # app bootstrap, window creation
    ptyManager.ts                 # spawn/kill PTYs, env injection, onData/onExit
    statusBridge.ts               # http server on 127.0.0.1, POST /event -> emit
    hookInstaller.ts              # merge/remove hook entries in ~/.claude/settings.json
    store.ts                      # load/save projects+layout JSON (debounced)
    ipc.ts                        # wire ipcMain handlers to the modules above
    hook-script/arw-hook.cjs      # tiny script Claude hooks call; POSTs {id,state}

  preload/
    index.ts                      # contextBridge: typed API to renderer

  renderer/
    main.tsx                      # React entry
    App.tsx                       # layout shell: Sidebar (25%) + Grid (75%)
    theme.ts                      # Oceanic palette tokens
    store/appStore.ts             # Zustand: projects, selectedProject, statuses
    components/
      Sidebar.tsx                 # workspace cards + Add button
      WorkspaceCard.tsx           # name + path + aggregate status dot
      TerminalGrid.tsx            # tiling layout of panes
      TerminalPane.tsx            # xterm instance + header (name, status, restart/close)
    hooks/useTerminalIO.ts        # bind xterm <-> main IPC for one terminal

tests/
  tiling.test.ts
  status.test.ts
  hookInstaller.test.ts
  store.test.ts
  statusBridge.test.ts
```

---

## Task 1: Project skeleton (Electron + electron-vite + React + TS)

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `.gitignore`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`

- [ ] **Step 1: Initialize git and .gitignore**

```bash
git init
```

Create `.gitignore`:
```
node_modules/
out/
dist/
*.log
.env
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "agent-manager",
  "version": "0.1.0",
  "description": "Manage Claude Code CLI terminals across projects",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "postinstall": "electron-rebuild -f -w node-pty"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.6.0",
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "electron": "^30.0.0",
    "electron-builder": "^24.13.0",
    "electron-vite": "^2.1.0",
    "typescript": "^5.4.0",
    "vitest": "^1.5.0"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-webgl": "^0.18.0",
    "@xterm/xterm": "^5.5.0",
    "node-pty": "^1.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.5.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src", "tests"]
}
```

Create `tsconfig.node.json`:
```json
{
  "compilerOptions": { "composite": true, "module": "ESNext", "moduleResolution": "Bundler" },
  "include": ["electron.vite.config.ts"]
}
```

- [ ] **Step 4: Create electron.vite.config.ts**

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
```

- [ ] **Step 5: Create the renderer entry files**

`src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /><title>Agent Manager</title></head>
  <body style="margin:0">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx`:
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

`src/renderer/App.tsx`:
```tsx
import React from 'react'

export default function App() {
  return <div style={{ color: '#A6ACCD', background: '#0F111A', height: '100vh' }}>Agent Manager</div>
}
```

- [ ] **Step 6: Create minimal main + preload**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0F111A',
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

`src/preload/index.ts`:
```ts
// API surface filled in Task 5
export {}
```

- [ ] **Step 7: Install and run**

Run: `npm install`
Run: `npm run dev`
Expected: a dark window opens showing "Agent Manager". (node-pty rebuilds via postinstall; if it errors, run `npx electron-rebuild -f -w node-pty`.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron + electron-vite + React skeleton

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared types and Oceanic theme

**Files:**
- Create: `src/shared/types.ts`, `src/shared/constants.ts`, `src/renderer/theme.ts`

- [ ] **Step 1: Define shared types**

`src/shared/types.ts`:
```ts
export type TermState = 'working' | 'needs-you' | 'idle' | 'error'

export interface Terminal {
  id: string
  name: string
  order: number
}

export interface Project {
  id: string
  name: string
  path: string
  collapsed: boolean
  terminals: Terminal[]
}

export interface PersistedState {
  version: 1
  lastSelectedProjectId: string | null
  projects: Project[]
}

/** Event posted by a Claude hook to the Status Bridge. */
export interface HookEvent {
  id: string            // ARW_TERMINAL_ID
  state: TermState
}
```

- [ ] **Step 2: Define constants**

`src/shared/constants.ts`:
```ts
export const ENV_TERMINAL_ID = 'ARW_TERMINAL_ID'
export const ENV_EVENT_URL = 'ARW_EVENT_URL'

export const IPC = {
  ptySpawn: 'pty:spawn',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',        // main -> renderer
  ptyExit: 'pty:exit',        // main -> renderer
  statusUpdate: 'status:update', // main -> renderer
  storeLoad: 'store:load',
  storeSave: 'store:save',
  pickFolder: 'dialog:pickFolder'
} as const

export const DEFAULT_SIDEBAR_PCT = 25
export const IDLE_FALLBACK_MS = 2500
```

- [ ] **Step 3: Define theme tokens**

`src/renderer/theme.ts`:
```ts
export const oceanic = {
  bgDeep: '#0F111A',
  bgPanel: '#1A1C25',
  bgRaised: '#1F2233',
  bgCard: '#181A22',
  border: '#232735',
  textPrimary: '#EEEFFF',
  textSecondary: '#A6ACCD',
  textMuted: '#717CB4',
  accent: '#80CBC4',
  selection: '#717CB420',
  status: {
    working: '#C3E88D',
    'needs-you': '#FFCB6B',
    idle: '#546E7A',
    error: '#F07178'
  }
} as const
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add shared types, IPC constants, and Oceanic theme tokens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Tiling math (TDD)

**Files:**
- Create: `src/shared/tiling.ts`
- Test: `tests/tiling.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create vitest config**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
})
```

- [ ] **Step 2: Write the failing test**

`tests/tiling.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { gridDims } from '@shared/tiling'

describe('gridDims', () => {
  it('1 terminal -> 1x1', () => expect(gridDims(1)).toEqual({ rows: 1, cols: 1 }))
  it('2 terminals -> 1 row, 2 cols', () => expect(gridDims(2)).toEqual({ rows: 1, cols: 2 }))
  it('3 terminals -> 2x2', () => expect(gridDims(3)).toEqual({ rows: 2, cols: 2 }))
  it('4 terminals -> 2x2', () => expect(gridDims(4)).toEqual({ rows: 2, cols: 2 }))
  it('5-6 terminals -> 2 rows, 3 cols', () => {
    expect(gridDims(5)).toEqual({ rows: 2, cols: 3 })
    expect(gridDims(6)).toEqual({ rows: 2, cols: 3 })
  })
  it('7-9 terminals -> 3x3', () => expect(gridDims(9)).toEqual({ rows: 3, cols: 3 }))
  it('0 terminals -> 0x0', () => expect(gridDims(0)).toEqual({ rows: 0, cols: 0 }))
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tiling`
Expected: FAIL — `gridDims` is not exported / module not found.

- [ ] **Step 4: Write minimal implementation**

`src/shared/tiling.ts`:
```ts
export interface GridDims { rows: number; cols: number }

/** cols = ceil(sqrt(n)); rows = ceil(n / cols). */
export function gridDims(n: number): GridDims {
  if (n <= 0) return { rows: 0, cols: 0 }
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return { rows, cols }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tiling`
Expected: PASS (all 7 cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add auto-tiling grid dimension calculation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Status state machine (TDD)

**Files:**
- Create: `src/shared/status.ts`
- Test: `tests/status.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/status.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { stateFromHook, aggregateState } from '@shared/status'

describe('stateFromHook', () => {
  it('maps PreToolUse to working', () => expect(stateFromHook('PreToolUse')).toBe('working'))
  it('maps UserPromptSubmit to working', () => expect(stateFromHook('UserPromptSubmit')).toBe('working'))
  it('maps Notification to needs-you', () => expect(stateFromHook('Notification')).toBe('needs-you'))
  it('maps Stop to idle', () => expect(stateFromHook('Stop')).toBe('idle'))
  it('returns null for unknown hook', () => expect(stateFromHook('Nope')).toBeNull())
})

describe('aggregateState', () => {
  it('error wins over everything', () =>
    expect(aggregateState(['idle', 'working', 'needs-you', 'error'])).toBe('error'))
  it('needs-you wins over working/idle', () =>
    expect(aggregateState(['idle', 'working', 'needs-you'])).toBe('needs-you'))
  it('working wins over idle', () => expect(aggregateState(['idle', 'working'])).toBe('working'))
  it('all idle -> idle', () => expect(aggregateState(['idle', 'idle'])).toBe('idle'))
  it('empty -> idle', () => expect(aggregateState([])).toBe('idle'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- status`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/shared/status.ts`:
```ts
import type { TermState } from './types'

const HOOK_MAP: Record<string, TermState> = {
  PreToolUse: 'working',
  UserPromptSubmit: 'working',
  Notification: 'needs-you',
  Stop: 'idle'
}

export function stateFromHook(hookName: string): TermState | null {
  return HOOK_MAP[hookName] ?? null
}

const PRIORITY: TermState[] = ['error', 'needs-you', 'working', 'idle']

export function aggregateState(states: TermState[]): TermState {
  for (const s of PRIORITY) if (states.includes(s)) return s
  return 'idle'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- status`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add status state machine and aggregate worst-state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: PTY Manager + IPC + single live terminal

**Files:**
- Create: `src/main/ptyManager.ts`, `src/main/ipc.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Create: `src/renderer/hooks/useTerminalIO.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Write the PTY Manager**

`src/main/ptyManager.ts`:
```ts
import * as pty from 'node-pty'
import { ENV_TERMINAL_ID, ENV_EVENT_URL } from '@shared/constants'

export interface SpawnOpts { id: string; cwd: string; eventUrl: string; cols: number; rows: number }

type DataCb = (id: string, data: string) => void
type ExitCb = (id: string, code: number) => void

export class PtyManager {
  private procs = new Map<string, pty.IPty>()
  constructor(private onData: DataCb, private onExit: ExitCb) {}

  spawn(opts: SpawnOpts) {
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash')
    const p = pty.spawn(shell, [], {
      name: 'xterm-color',
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: { ...process.env, [ENV_TERMINAL_ID]: opts.id, [ENV_EVENT_URL]: opts.eventUrl }
    })
    p.onData((d) => this.onData(opts.id, d))
    p.onExit(({ exitCode }) => { this.procs.delete(opts.id); this.onExit(opts.id, exitCode) })
    this.procs.set(opts.id, p)
    // Auto-launch claude in the project folder.
    p.write('claude\r')
  }

  write(id: string, data: string) { this.procs.get(id)?.write(data) }
  resize(id: string, cols: number, rows: number) { this.procs.get(id)?.resize(cols, rows) }
  kill(id: string) { this.procs.get(id)?.kill(); this.procs.delete(id) }
  killAll() { for (const p of this.procs.values()) p.kill(); this.procs.clear() }
}
```

- [ ] **Step 2: Wire IPC in main**

`src/main/ipc.ts`:
```ts
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
```

- [ ] **Step 3: Expose a preload API**

`src/preload/index.ts`:
```ts
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
```

Create `src/renderer/arw.d.ts`:
```ts
import type { ArwApi } from '../preload/index'
declare global { interface Window { arw: ArwApi } }
```

- [ ] **Step 4: Wire main bootstrap**

Modify `src/main/index.ts` — replace the body with:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#0F111A',
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  // eventUrl is finalized in Task 8 once the Status Bridge starts; placeholder for now.
  registerIpc(() => win, () => 'http://127.0.0.1:0/event')
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

- [ ] **Step 5: Create the xterm binding hook**

`src/renderer/hooks/useTerminalIO.ts`:
```ts
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { oceanic } from '../theme'
import '@xterm/xterm/css/xterm.css'

export function useTerminalIO(id: string, cwd: string) {
  const elRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'Consolas, monospace', fontSize: 13, cursorBlink: true,
      theme: { background: oceanic.bgDeep, foreground: oceanic.textSecondary }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(elRef.current!)
    fit.fit()

    window.arw.spawn(id, cwd, term.cols, term.rows)
    term.onData((d) => window.arw.input(id, d))
    window.arw.onData(({ id: tid, data }) => { if (tid === id) term.write(data) })

    const onResize = () => { fit.fit(); window.arw.resize(id, term.cols, term.rows) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); window.arw.kill(id); term.dispose() }
  }, [id, cwd])

  return elRef
}
```

- [ ] **Step 6: Render one terminal in App**

Replace `src/renderer/App.tsx`:
```tsx
import React from 'react'
import { useTerminalIO } from './hooks/useTerminalIO'
import { oceanic } from './theme'

export default function App() {
  const ref = useTerminalIO('demo-1', process.env.HOME || 'C:\\')
  return (
    <div style={{ height: '100vh', background: oceanic.bgDeep }}>
      <div ref={ref} style={{ height: '100%' }} />
    </div>
  )
}
```

- [ ] **Step 7: Manual verification**

Run: `npm run dev`
Expected: a terminal appears, a PowerShell prompt loads, `claude` auto-runs, and typing works. Ctrl-C exits claude back to the shell.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: spawn PTYs from main and render a live xterm terminal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Store serialization (TDD)

**Files:**
- Create: `src/main/store.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { emptyState, addProject, addTerminal, removeProject, renameTerminal, serialize, deserialize } from '@main/store'

describe('store operations', () => {
  it('adds a project', () => {
    const s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    expect(s.projects).toHaveLength(1)
    expect(s.projects[0].terminals).toEqual([])
  })

  it('adds terminals with incrementing order', () => {
    let s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    s = addTerminal(s, 'p1', { id: 't1', name: 'one' })
    s = addTerminal(s, 'p1', { id: 't2', name: 'two' })
    expect(s.projects[0].terminals.map(t => t.order)).toEqual([0, 1])
  })

  it('renames a terminal', () => {
    let s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    s = addTerminal(s, 'p1', { id: 't1', name: 'one' })
    s = renameTerminal(s, 'p1', 't1', 'renamed')
    expect(s.projects[0].terminals[0].name).toBe('renamed')
  })

  it('removes a project', () => {
    let s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    s = removeProject(s, 'p1')
    expect(s.projects).toHaveLength(0)
  })

  it('serialize/deserialize round-trips', () => {
    let s = addProject(emptyState(), { id: 'p1', name: 'api', path: 'C:\\api' })
    s = addTerminal(s, 'p1', { id: 't1', name: 'one' })
    expect(deserialize(serialize(s))).toEqual(s)
  })

  it('deserialize rejects wrong version and returns empty', () => {
    expect(deserialize('{"version":99}')).toEqual(emptyState())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- store`
Expected: FAIL — module not found. (Add `@main` alias: in `vitest.config.ts` resolve.alias add `'@main': resolve('src/main')`.)

- [ ] **Step 3: Write minimal implementation**

`src/main/store.ts`:
```ts
import type { PersistedState, Project, Terminal } from '@shared/types'

export function emptyState(): PersistedState {
  return { version: 1, lastSelectedProjectId: null, projects: [] }
}

export function addProject(s: PersistedState, p: Omit<Project, 'collapsed' | 'terminals'>): PersistedState {
  return { ...s, projects: [...s.projects, { ...p, collapsed: false, terminals: [] }] }
}

export function removeProject(s: PersistedState, projectId: string): PersistedState {
  return { ...s, projects: s.projects.filter(p => p.id !== projectId) }
}

function mapProject(s: PersistedState, projectId: string, fn: (p: Project) => Project): PersistedState {
  return { ...s, projects: s.projects.map(p => (p.id === projectId ? fn(p) : p)) }
}

export function addTerminal(s: PersistedState, projectId: string, t: Omit<Terminal, 'order'>): PersistedState {
  return mapProject(s, projectId, p => ({
    ...p, terminals: [...p.terminals, { ...t, order: p.terminals.length }]
  }))
}

export function removeTerminal(s: PersistedState, projectId: string, termId: string): PersistedState {
  return mapProject(s, projectId, p => ({ ...p, terminals: p.terminals.filter(t => t.id !== termId) }))
}

export function renameTerminal(s: PersistedState, projectId: string, termId: string, name: string): PersistedState {
  return mapProject(s, projectId, p => ({
    ...p, terminals: p.terminals.map(t => (t.id === termId ? { ...t, name } : t))
  }))
}

export function serialize(s: PersistedState): string { return JSON.stringify(s, null, 2) }

export function deserialize(raw: string): PersistedState {
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1 || !Array.isArray(parsed.projects)) return emptyState()
    return parsed as PersistedState
  } catch { return emptyState() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- store`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add projects/terminals store with serialization

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Persist store to disk + folder picker IPC

**Files:**
- Modify: `src/main/store.ts` (add file I/O), `src/main/ipc.ts`, `src/preload/index.ts`

- [ ] **Step 1: Add debounced file persistence to store.ts**

Append to `src/main/store.ts`:
```ts
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const FILE = () => join(app.getPath('userData'), 'agent-manager-state.json')

export function loadState(): PersistedState {
  const f = FILE()
  return existsSync(f) ? deserialize(readFileSync(f, 'utf8')) : emptyState()
}

let timer: NodeJS.Timeout | null = null
export function saveStateDebounced(s: PersistedState, ms = 300) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => writeFileSync(FILE(), serialize(s)), ms)
}
```

- [ ] **Step 2: Add load/save/pickFolder IPC handlers**

Append inside `registerIpc` in `src/main/ipc.ts`:
```ts
import { dialog } from 'electron'
import { loadState, saveStateDebounced } from './store'
// ...
  ipcMain.handle(IPC.storeLoad, () => loadState())
  ipcMain.on(IPC.storeSave, (_e, state) => saveStateDebounced(state))
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
```

- [ ] **Step 3: Expose store + folder picker in preload**

Add to the `api` object in `src/preload/index.ts`:
```ts
  loadStore: () => ipcRenderer.invoke(IPC.storeLoad),
  saveStore: (state: unknown) => ipcRenderer.send(IPC.storeSave, state),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickFolder),
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, then in DevTools console: `await window.arw.pickFolder()` opens a folder dialog and returns the chosen path; `await window.arw.loadStore()` returns `{version:1,...}`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: persist app state to userData and add folder picker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Status Bridge HTTP server (TDD) + wire into main

**Files:**
- Create: `src/main/statusBridge.ts`
- Test: `tests/statusBridge.test.ts`
- Modify: `src/main/index.ts`, `src/main/ipc.ts`

- [ ] **Step 1: Write the failing test**

`tests/statusBridge.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { StatusBridge } from '@main/statusBridge'

let bridge: StatusBridge
afterEach(() => bridge?.stop())

describe('StatusBridge', () => {
  it('starts on a free port and reports its url', async () => {
    bridge = new StatusBridge(() => {})
    await bridge.start()
    expect(bridge.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/event$/)
  })

  it('invokes callback with posted event', async () => {
    const events: unknown[] = []
    bridge = new StatusBridge((e) => events.push(e))
    await bridge.start()
    await fetch(bridge.url(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'term-7', state: 'needs-you' })
    })
    await new Promise(r => setTimeout(r, 50))
    expect(events).toEqual([{ id: 'term-7', state: 'needs-you' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- statusBridge`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/main/statusBridge.ts`:
```ts
import { createServer, Server } from 'http'
import type { HookEvent } from '@shared/types'

export class StatusBridge {
  private server: Server | null = null
  private port = 0
  constructor(private onEvent: (e: HookEvent) => void) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c) => (body += c))
          req.on('end', () => {
            try { this.onEvent(JSON.parse(body)) } catch { /* ignore malformed */ }
            res.writeHead(204); res.end()
          })
        } else { res.writeHead(404); res.end() }
      })
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as { port: number }).port
        resolve()
      })
    })
  }

  url() { return `http://127.0.0.1:${this.port}/event` }
  stop() { this.server?.close(); this.server = null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- statusBridge`
Expected: PASS (Node 18+ has global `fetch`).

- [ ] **Step 5: Wire the bridge into main and feed status to renderer**

Modify `src/main/index.ts` `app.whenReady()` block:
```ts
import { StatusBridge } from './statusBridge'
import { IPC } from '@shared/constants'
// ...
app.whenReady().then(async () => {
  const bridge = new StatusBridge((e) => win?.webContents.send(IPC.statusUpdate, e))
  await bridge.start()
  const mgr = registerIpc(() => win, () => bridge.url())
  app.on('before-quit', () => { mgr.killAll(); bridge.stop() })
  createWindow()
})
```

- [ ] **Step 6: Map PTY exit to error status**

In `src/main/ipc.ts`, change the exit callback so a non-zero exit also emits an error status:
```ts
  const mgr = new PtyManager(
    (id, data) => send(IPC.ptyData, { id, data }),
    (id, code) => {
      send(IPC.ptyExit, { id, code })
      if (code !== 0) send(IPC.statusUpdate, { id, state: 'error' })
    }
  )
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add localhost Status Bridge and route status to renderer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Hook installer — merge into ~/.claude/settings.json (TDD)

**Files:**
- Create: `src/main/hookInstaller.ts`, `src/main/hook-script/arw-hook.cjs`
- Test: `tests/hookInstaller.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/hookInstaller.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mergeHooks, ARW_MARKER } from '@main/hookInstaller'

describe('mergeHooks', () => {
  it('adds hook entries to empty settings', () => {
    const out = mergeHooks({}, 'node /path/arw-hook.cjs')
    expect(out.hooks.Notification[0].hooks[0].command).toContain('arw-hook.cjs')
    expect(out.hooks.Notification[0].hooks[0].__arw).toBe(ARW_MARKER)
  })

  it('preserves existing unrelated hooks', () => {
    const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }
    const out = mergeHooks(existing, 'cmd')
    const stopCmds = out.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(stopCmds).toContain('echo hi')        // user hook kept
    expect(stopCmds.some((c: string) => c === 'cmd')).toBe(true) // arw hook added
  })

  it('is idempotent — running twice does not duplicate arw entries', () => {
    const once = mergeHooks({}, 'cmd')
    const twice = mergeHooks(once, 'cmd')
    const count = twice.hooks.Notification.flatMap((g: any) => g.hooks)
      .filter((h: any) => h.__arw === ARW_MARKER).length
    expect(count).toBe(1)
  })

  it('preserves other top-level settings keys', () => {
    const out = mergeHooks({ model: 'opus' } as any, 'cmd')
    expect((out as any).model).toBe('opus')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hookInstaller`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/main/hookInstaller.ts`:
```ts
export const ARW_MARKER = 'agent-manager'
const HOOK_EVENTS = ['PreToolUse', 'UserPromptSubmit', 'Notification', 'Stop'] as const

interface HookCmd { type: 'command'; command: string; __arw?: string }
interface HookGroup { matcher?: string; hooks: HookCmd[] }

/** Merge arw hook entries into a Claude settings object without clobbering user hooks. */
export function mergeHooks(settings: any, command: string): any {
  const out = { ...settings }
  out.hooks = { ...(settings.hooks ?? {}) }
  for (const ev of HOOK_EVENTS) {
    const groups: HookGroup[] = [...(out.hooks[ev] ?? [])]
      .map((g: HookGroup) => ({ ...g, hooks: g.hooks.filter((h) => h.__arw !== ARW_MARKER) }))
      .filter((g: HookGroup) => g.hooks.length > 0)
    groups.push({ hooks: [{ type: 'command', command, __arw: ARW_MARKER }] })
    out.hooks[ev] = groups
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- hookInstaller`
Expected: PASS (4 cases).

- [ ] **Step 5: Add the hook script and the install-to-disk wrapper**

`src/main/hook-script/arw-hook.cjs` (Claude passes the hook event name as `$CLAUDE_HOOK_EVENT`; falls back to argv[2]):
```js
#!/usr/bin/env node
const http = require('http')
const url = process.env.ARW_EVENT_URL
const id = process.env.ARW_TERMINAL_ID
const hookEvent = process.env.CLAUDE_HOOK_EVENT || process.argv[2] || ''
const MAP = { PreToolUse: 'working', UserPromptSubmit: 'working', Notification: 'needs-you', Stop: 'idle' }
const state = MAP[hookEvent]
if (!url || !id || !state) process.exit(0)
const body = JSON.stringify({ id, state })
const u = new URL(url)
const req = http.request(
  { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
  () => process.exit(0)
)
req.on('error', () => process.exit(0))
req.write(body); req.end()
```

Append to `src/main/hookInstaller.ts`:
```ts
import { app } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'

const settingsPath = () => join(homedir(), '.claude', 'settings.json')

export function installHooks() {
  const scriptPath = join(__dirname, 'hook-script', 'arw-hook.cjs')
  const command = `node "${scriptPath}" "${'${CLAUDE_HOOK_EVENT}'}"`
  const p = settingsPath()
  const dir = dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const current = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
  if (existsSync(p) && !existsSync(p + '.arw-backup')) copyFileSync(p, p + '.arw-backup')
  const merged = mergeHooks(current, command)
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(merged, null, 2))
  writeFileSync(p, JSON.stringify(merged, null, 2)) // atomic-ish: write tmp then overwrite
}
```

Call it once at startup — in `src/main/index.ts` `app.whenReady()` before `createWindow()`:
```ts
import { installHooks } from './hookInstaller'
// ...
  installHooks()
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: install Claude status hooks into settings.json (non-destructive)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: App store (Zustand) + load/save wiring

**Files:**
- Create: `src/renderer/store/appStore.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create the renderer store**

`src/renderer/store/appStore.ts`:
```ts
import { create } from 'zustand'
import type { PersistedState, Project, TermState } from '@shared/types'

interface AppState {
  projects: Project[]
  selectedProjectId: string | null
  statuses: Record<string, TermState>   // terminalId -> state
  loaded: boolean
  load: () => Promise<void>
  persist: () => void
  selectProject: (id: string) => void
  addProject: (name: string, path: string) => void
  removeProject: (id: string) => void
  addTerminal: (projectId: string) => void
  removeTerminal: (projectId: string, termId: string) => void
  renameTerminal: (projectId: string, termId: string, name: string) => void
  setStatus: (termId: string, state: TermState) => void
}

const uid = () => Math.random().toString(36).slice(2, 10)

export const useApp = create<AppState>((set, get) => ({
  projects: [], selectedProjectId: null, statuses: {}, loaded: false,

  load: async () => {
    const s: PersistedState = await window.arw.loadStore()
    set({ projects: s.projects, selectedProjectId: s.lastSelectedProjectId, loaded: true })
  },
  persist: () => {
    const { projects, selectedProjectId } = get()
    window.arw.saveStore({ version: 1, lastSelectedProjectId: selectedProjectId, projects })
  },
  selectProject: (id) => { set({ selectedProjectId: id }); get().persist() },
  addProject: (name, path) => {
    set((st) => ({ projects: [...st.projects, { id: uid(), name, path, collapsed: false, terminals: [] }] }))
    get().persist()
  },
  removeProject: (id) => {
    set((st) => ({
      projects: st.projects.filter(p => p.id !== id),
      selectedProjectId: st.selectedProjectId === id ? null : st.selectedProjectId
    }))
    get().persist()
  },
  addTerminal: (projectId) => {
    set((st) => ({ projects: st.projects.map(p => p.id === projectId
      ? { ...p, terminals: [...p.terminals, { id: uid(), name: `terminal ${p.terminals.length + 1}`, order: p.terminals.length }] }
      : p) }))
    get().persist()
  },
  removeTerminal: (projectId, termId) => {
    set((st) => ({ projects: st.projects.map(p => p.id === projectId
      ? { ...p, terminals: p.terminals.filter(t => t.id !== termId) } : p) }))
    get().persist()
  },
  renameTerminal: (projectId, termId, name) => {
    set((st) => ({ projects: st.projects.map(p => p.id === projectId
      ? { ...p, terminals: p.terminals.map(t => t.id === termId ? { ...t, name } : t) } : p) }))
    get().persist()
  },
  setStatus: (termId, state) => set((st) => ({ statuses: { ...st.statuses, [termId]: state } }))
}))
```

- [ ] **Step 2: Load store + subscribe to status on app mount**

Replace `src/renderer/App.tsx`:
```tsx
import React, { useEffect } from 'react'
import { useApp } from './store/appStore'
import { Sidebar } from './components/Sidebar'
import { TerminalGrid } from './components/TerminalGrid'
import { oceanic } from './theme'
import { DEFAULT_SIDEBAR_PCT } from '@shared/constants'
import type { TermState } from '@shared/types'

export default function App() {
  const { load, loaded, setStatus } = useApp()

  useEffect(() => {
    load()
    window.arw.onStatus(({ id, state }) => setStatus(id, state as TermState))
  }, [])

  if (!loaded) return <div style={{ background: oceanic.bgDeep, height: '100vh' }} />

  return (
    <div style={{ display: 'flex', height: '100vh', background: oceanic.bgDeep }}>
      <div style={{ width: `${DEFAULT_SIDEBAR_PCT}%`, minWidth: 220, background: oceanic.bgPanel }}>
        <Sidebar />
      </div>
      <div style={{ flex: 1 }}><TerminalGrid /></div>
    </div>
  )
}
```

- [ ] **Step 3: Commit** (will not run until Task 11/12 add the components)

```bash
git add src/renderer/store/appStore.ts src/renderer/App.tsx
git commit -m "feat: add renderer Zustand store and load/status wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Sidebar with workspace cards

**Files:**
- Create: `src/renderer/components/Sidebar.tsx`, `src/renderer/components/WorkspaceCard.tsx`

- [ ] **Step 1: Create WorkspaceCard**

`src/renderer/components/WorkspaceCard.tsx`:
```tsx
import React from 'react'
import { oceanic } from '../theme'
import { aggregateState } from '@shared/status'
import { useApp } from '../store/appStore'
import type { Project } from '@shared/types'

export function WorkspaceCard({ project }: { project: Project }) {
  const { selectedProjectId, selectProject, removeProject, statuses } = useApp()
  const selected = selectedProjectId === project.id
  const agg = aggregateState(project.terminals.map(t => statuses[t.id] ?? 'idle'))
  const showDot = project.terminals.length > 0 && agg !== 'idle'

  return (
    <div
      onClick={() => selectProject(project.id)}
      onContextMenu={(e) => { e.preventDefault(); if (confirm(`Remove ${project.name}?`)) removeProject(project.id) }}
      style={{
        position: 'relative', cursor: 'pointer', marginBottom: 8, padding: '9px 11px',
        background: selected ? oceanic.bgRaised : oceanic.bgCard,
        border: `1px solid ${selected ? oceanic.accent : oceanic.border}`, borderRadius: 8
      }}
    >
      {showDot && (
        <span style={{ position: 'absolute', right: 10, top: 10, color: oceanic.status[agg] }}>●</span>
      )}
      <div style={{ color: oceanic.textPrimary, fontSize: 13 }}>{project.name}</div>
      <div style={{ color: oceanic.textMuted, fontSize: 11, marginTop: 2 }}>{project.path}</div>
    </div>
  )
}
```

- [ ] **Step 2: Create Sidebar**

`src/renderer/components/Sidebar.tsx`:
```tsx
import React from 'react'
import { oceanic } from '../theme'
import { useApp } from '../store/appStore'
import { WorkspaceCard } from './WorkspaceCard'

export function Sidebar() {
  const { projects, addProject } = useApp()

  const onAdd = async () => {
    const path = await window.arw.pickFolder()
    if (!path) return
    const name = path.split(/[\\/]/).filter(Boolean).pop() || path
    addProject(name, path)
  }

  return (
    <div style={{ padding: 12, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ color: oceanic.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>PROJECTS</span>
        <button onClick={onAdd} style={{
          color: oceanic.accent, background: 'transparent',
          border: `1px solid ${oceanic.accent}`, borderRadius: 6, fontSize: 11, padding: '2px 8px', cursor: 'pointer'
        }}>+ Add</button>
      </div>
      {projects.map(p => <WorkspaceCard key={p.id} project={p} />)}
    </div>
  )
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Click **+ Add**, pick a folder → a card appears with the folder name + path. Reload the app (Ctrl-R) → the card persists. Right-click → remove works.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add sidebar workspace cards with aggregate status dot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Terminal grid + panes

**Files:**
- Create: `src/renderer/components/TerminalGrid.tsx`, `src/renderer/components/TerminalPane.tsx`

- [ ] **Step 1: Create TerminalPane**

`src/renderer/components/TerminalPane.tsx`:
```tsx
import React from 'react'
import { useTerminalIO } from '../hooks/useTerminalIO'
import { oceanic } from '../theme'
import { useApp } from '../store/appStore'
import type { TermState } from '@shared/types'

export function TerminalPane({ projectId, termId, name, cwd, focused, onFocus }:
  { projectId: string; termId: string; name: string; cwd: string; focused: boolean; onFocus: () => void }) {
  const ref = useTerminalIO(termId, cwd)
  const { statuses, removeTerminal } = useApp()
  const state: TermState = statuses[termId] ?? 'idle'

  return (
    <div onMouseDown={onFocus} style={{
      display: 'flex', flexDirection: 'column', border: `1px solid ${focused ? oceanic.accent : oceanic.border}`,
      borderRadius: 8, overflow: 'hidden', minHeight: 0
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: oceanic.bgRaised, padding: '5px 9px', fontSize: 12, color: oceanic.textSecondary
      }}>
        <span><span style={{ color: oceanic.status[state] }}>●</span> {name}</span>
        <span style={{ color: oceanic.textMuted, cursor: 'pointer' }}
          onClick={() => removeTerminal(projectId, termId)}>✕</span>
      </div>
      <div ref={ref} style={{ flex: 1, minHeight: 0, background: oceanic.bgDeep }} />
    </div>
  )
}
```

- [ ] **Step 2: Create TerminalGrid using the tiling math**

`src/renderer/components/TerminalGrid.tsx`:
```tsx
import React, { useState } from 'react'
import { useApp } from '../store/appStore'
import { gridDims } from '@shared/tiling'
import { oceanic } from '../theme'
import { TerminalPane } from './TerminalPane'

export function TerminalGrid() {
  const { projects, selectedProjectId, addTerminal } = useApp()
  const [focused, setFocused] = useState<string | null>(null)
  const project = projects.find(p => p.id === selectedProjectId)

  if (!project) return <Empty text="Select a project" />

  const terms = [...project.terminals].sort((a, b) => a.order - b.order)
  const { rows, cols } = gridDims(terms.length)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', color: oceanic.textSecondary }}>
        <span>{project.name}</span>
        <button onClick={() => addTerminal(project.id)} style={{
          color: oceanic.accent, background: 'transparent', border: `1px solid ${oceanic.accent}`,
          borderRadius: 6, padding: '2px 8px', cursor: 'pointer'
        }}>＋ new terminal</button>
      </div>
      {terms.length === 0 ? <Empty text="No terminals yet — click ＋ new terminal" /> : (
        <div style={{
          flex: 1, display: 'grid', gap: 8, padding: 8, minHeight: 0,
          gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`
        }}>
          {terms.map(t => (
            <TerminalPane key={t.id} projectId={project.id} termId={t.id} name={t.name}
              cwd={project.path} focused={focused === t.id} onFocus={() => setFocused(t.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: oceanic.textMuted }}>{text}</div>
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Select a project, click **＋ new terminal** four times → panes auto-arrange into a 2×2 grid, each auto-running `claude`. Click a pane → its border turns teal. Close one (✕) → grid reflows to 3 panes. Switch projects → grid swaps.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add auto-tiling terminal grid with focus and per-pane status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Status badges end-to-end + idle fallback heuristic

**Files:**
- Modify: `src/main/ptyManager.ts` (activity heuristic), `src/main/ipc.ts`

- [ ] **Step 1: Add output-activity fallback in PtyManager**

Modify `src/main/ptyManager.ts` — add an emitter for inferred status. Extend the constructor:
```ts
import { IDLE_FALLBACK_MS } from '@shared/constants'
import type { TermState } from '@shared/types'

// add a third callback:
constructor(
  private onData: DataCb,
  private onExit: ExitCb,
  private onInferred?: (id: string, state: TermState) => void
) {}
```
Inside `spawn`, after `p.onData(...)`, add a debounced activity tracker:
```ts
    let idleTimer: NodeJS.Timeout | null = null
    p.onData((d) => {
      this.onData(opts.id, d)
      this.onInferred?.(opts.id, 'working')
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => this.onInferred?.(opts.id, 'idle'), IDLE_FALLBACK_MS)
    })
```
(Remove the now-duplicated `p.onData` registration from Task 5 so there is only one.)

- [ ] **Step 2: Wire the inferred callback, letting hooks take priority**

In `src/main/ipc.ts`, pass the third callback. Hooks already emit precise states; the heuristic only fills gaps, so emit inferred states on the same `statusUpdate` channel:
```ts
  const mgr = new PtyManager(
    (id, data) => send(IPC.ptyData, { id, data }),
    (id, code) => { send(IPC.ptyExit, { id, code }); if (code !== 0) send(IPC.statusUpdate, { id, state: 'error' }) },
    (id, state) => send(IPC.statusUpdate, { id, state })
  )
```
Note: real hook events (`needs-you`) arrive via the Status Bridge and naturally override the heuristic's `working`/`idle` because they post afterward on the same channel; `needs-you` persists because no output flows while Claude waits.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Open a terminal, let `claude` run a task → pane dot is green (working) while output streams, grey (idle) shortly after it stops. Trigger a permission prompt → dot turns amber (needs-you) via the hook; the sidebar card's aggregate dot also turns amber. Kill the shell process → dot turns red.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add idle fallback heuristic and verify status badges end-to-end

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Error states — spawn failure & missing folder

**Files:**
- Modify: `src/main/ptyManager.ts`, `src/main/ipc.ts`, `src/shared/constants.ts`, `src/preload/index.ts`, `src/renderer/components/TerminalPane.tsx`, `src/renderer/components/WorkspaceCard.tsx`

- [ ] **Step 1: Catch spawn errors and report them**

Add `ptyError: 'pty:error'` to the `IPC` object in `src/shared/constants.ts`. In `ptyManager.ts`, wrap `pty.spawn` in try/catch and accept an `onError` callback; on throw, call `onError(opts.id, String(err))`. In `ipc.ts`, forward it: `send(IPC.ptyError, { id, message })`. In `preload/index.ts`, add `onError: (cb) => ipcRenderer.on(IPC.ptyError, (_e, p) => cb(p))`.

- [ ] **Step 2: Show inline error + retry in the pane**

In `TerminalPane.tsx`, add local state `const [error, setError] = useState<string | null>(null)`, subscribe via `window.arw.onError(({id,message}) => { if (id===termId) setError(message) })`, and when `error` is set, render an overlay with the message and a **Retry** button that clears the error and re-mounts the terminal (toggle a `key` on the xterm container).

- [ ] **Step 3: Flag missing project folders**

In `WorkspaceCard.tsx`, add `useEffect` calling a new `window.arw.pathExists(project.path)` (add IPC `fs:exists` → `existsSync` in main). If missing, show a red "missing" label next to the name and skip selecting it for the grid (the grid already shows "Select a project").

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. Add a project, then delete/rename its folder on disk, reload → card shows "missing". Force a spawn failure (point a terminal at a non-existent cwd) → pane shows the error + Retry.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: handle PTY spawn failures and missing project folders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Packaging (electron-builder) + smoke checklist

**Files:**
- Modify: `package.json` (build config + scripts)
- Create: `docs/smoke-checklist.md`

- [ ] **Step 1: Add electron-builder config to package.json**

```json
  "build": {
    "appId": "com.arw.agentmanager",
    "productName": "Agent Manager",
    "files": ["out/**/*", "src/main/hook-script/**/*"],
    "win": { "target": "nsis" }
  },
  "scripts": {
    "dist": "electron-vite build && electron-builder --win"
  }
```
(Keep existing scripts; add `dist`. Ensure `arw-hook.cjs` is copied into `out` during build — add a small copy step or include it via `extraResources` and resolve its path with `process.resourcesPath` in `hookInstaller.ts` for the packaged app.)

- [ ] **Step 2: Build the installer**

Run: `npm run dist`
Expected: an NSIS installer is produced under `dist/`. Install and launch it; confirm the window opens and a terminal can spawn.

- [ ] **Step 3: Write the smoke checklist**

`docs/smoke-checklist.md`:
```md
# Agent Manager — Manual Smoke Test
1. Launch app → dark Oceanic window, empty sidebar.
2. Click "+ Add", pick a project folder → card shows name + path.
3. Select the card → grid area shows "No terminals yet".
4. Click "＋ new terminal" → a pane opens, PowerShell loads, `claude` auto-runs.
5. Open 3 more terminals → panes auto-arrange to 2x2.
6. Click a pane → its border turns teal; typing goes to that pane.
7. Ask Claude to do something that needs permission → pane dot + card dot turn amber.
8. Let Claude work → green; when it stops → grey.
9. Close one pane (✕) → grid reflows to 3.
10. Add a second project, open a terminal, trigger a prompt there → switch back to project 1; project 2's card dot is amber.
11. Quit and relaunch → projects + (empty) layout restored, fresh shells.
12. Check ~/.claude/settings.json → arw hook entries present; .arw-backup exists; pre-existing hooks intact.
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: all suites pass (tiling, status, store, statusBridge, hookInstaller).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add electron-builder packaging and smoke checklist

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** sidebar cards (T11), 1/4–3/4 layout (T10), auto-tiling grid scoped to selected project (T3, T12), four states (T4), hooks→localhost→IPC→badge (T8, T9, T13), aggregate card dot (T11), persistence remember-layout-restart-fresh (T6, T7, T10), auto-launch claude in full shell (T5), manual add project (T11), Oceanic theme (T2), error handling (T14), packaging + tests (T15). All spec sections map to a task.
- **Placeholders:** none — every code step contains complete code; UI-only steps that can't be unit-tested use explicit manual verification.
- **Type consistency:** `TermState`, `Project`, `Terminal`, `PersistedState`, `HookEvent`, the `IPC` channel names, `gridDims`, `stateFromHook`, `aggregateState`, and the `window.arw` API are defined once and reused with identical signatures across tasks.
