import { create } from 'zustand'
import { DEFAULT_THEME_ID, applyUiTheme, getTheme } from '../themes'
import { fileKey } from '../ide/paths'
import type { IdePatch, IdeStateData } from '../../main/ideState'

/** Breakpoints for one file. `path` keeps the real on-disk spelling (sent to the debugger). */
export interface FileBreakpoints { path: string; lines: number[] }

export interface ProjectTabs { paths: string[]; active: string | null }

export type FileStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; dirty: boolean }
  | { kind: 'binary' }
  | { kind: 'tooLarge'; size: number }
  | { kind: 'error'; message: string }

interface IdeState {
  // ---- shared (main process owns the copy; every change goes out as a patch) ----
  themeId: string
  breakpoints: Record<string, FileBreakpoints>
  tabs: Record<string, ProjectTabs>   // projectId -> open editor tabs
  bottomHeight: number                // px height of the Debug tool window
  treeWidth: number                   // px width of the IDE window's project tree
  treeOpen: boolean

  // ---- window-local ----
  loaded: boolean
  /** per-file load/dirty status, keyed by fileKey */
  files: Record<string, FileStatus>
  /** ask the editor to scroll to / place the caret on this line once the file shows */
  reveal: { key: string; line: number; nonce: number } | null
  /** closing a tab with unsaved changes waits for confirmation */
  closeRequest: { projectId: string; path: string } | null
  /** one-line message over the editor (e.g. a failed save) */
  notice: string | null
  /** Debug tool window shown under the editor */
  debugOpen: boolean

  load: () => Promise<void>
  setTheme: (id: string) => void
  openFile: (projectId: string, path: string, line?: number) => void
  setActiveTab: (projectId: string, path: string) => void
  requestCloseTab: (projectId: string, path: string) => void
  closeTab: (projectId: string, path: string) => void
  cancelClose: () => void
  setFileStatus: (path: string, s: FileStatus) => void
  toggleBreakpoint: (path: string, line: number) => void
  setBreakpointLines: (path: string, lines: number[]) => void
  clearAllBreakpoints: () => void
  setBottomHeight: (px: number, commit?: boolean) => void
  setTreeWidth: (px: number, commit?: boolean) => void
  toggleTree: () => void
  setDebugOpen: (open: boolean) => void
}

export const clampBottom = (px: number) => Math.max(120, Math.min(1400, Math.round(px)))
export const clampTree = (px: number) => Math.max(180, Math.min(640, Math.round(px)))

const patch = (p: IdePatch) => window.arw.ide.patch(p)

/** Fold a patch (ours or another window's) into local state. */
function merge(st: IdeState, p: IdePatch): Partial<IdeState> {
  const out: Partial<IdeState> = {}
  if (p.themeId !== undefined) out.themeId = getTheme(p.themeId).id
  if (p.bottomHeight !== undefined) out.bottomHeight = clampBottom(p.bottomHeight)
  if (p.treeWidth !== undefined) out.treeWidth = clampTree(p.treeWidth)
  if (p.treeOpen !== undefined) out.treeOpen = p.treeOpen
  if (p.tabs) {
    const tabs = { ...st.tabs }
    for (const [k, v] of Object.entries(p.tabs)) { if (v) tabs[k] = v; else delete tabs[k] }
    out.tabs = tabs
  }
  if (p.breakpoints) {
    const bps = { ...st.breakpoints }
    for (const [k, v] of Object.entries(p.breakpoints)) { if (v && v.lines.length) bps[k] = v; else delete bps[k] }
    out.breakpoints = bps
  }
  return out
}

export const useIde = create<IdeState>((set, get) => {
  /** Apply locally and send to main. */
  const commit = (p: IdePatch) => { set((st) => merge(st, p)); patch(p) }
  const commitTabs = (projectId: string, t: ProjectTabs) => commit({ tabs: { [projectId]: t } })

  return {
    themeId: DEFAULT_THEME_ID, breakpoints: {}, tabs: {}, bottomHeight: 280, treeWidth: 280, treeOpen: true,
    loaded: false, files: {}, reveal: null, closeRequest: null, notice: null, debugOpen: false,

    load: async () => {
      let s: Partial<IdeStateData> | null = null
      try { s = (await window.arw.ide.load()) as Partial<IdeStateData> | null } catch { /* first run */ }
      const themeId = getTheme(s?.themeId).id
      set({
        themeId,
        breakpoints: s?.breakpoints ?? {},
        tabs: s?.tabs ?? {},
        bottomHeight: clampBottom(s?.bottomHeight ?? 280),
        treeWidth: clampTree(s?.treeWidth ?? 280),
        treeOpen: s?.treeOpen ?? true,
        loaded: true
      })
      applyUiTheme(getTheme(themeId))
      // Other windows' changes (theme switch, a file opened from the main window, …).
      window.arw.ide.onChanged((p) => {
        set((st) => merge(st, p))
        if (p.themeId !== undefined) applyUiTheme(getTheme(p.themeId))
      })
    },
    setTheme: (id) => {
      const t = getTheme(id)
      commit({ themeId: t.id })
      applyUiTheme(t)
    },

    openFile: (projectId, path, line) => {
      const cur = get().tabs[projectId] ?? { paths: [], active: null }
      const existing = cur.paths.find(p => fileKey(p) === fileKey(path))
      commitTabs(projectId, { paths: existing ? cur.paths : [...cur.paths, path], active: existing ?? path })
      if (line) set({ reveal: { key: fileKey(path), line, nonce: Math.random() } })
    },
    setActiveTab: (projectId, path) => {
      const cur = get().tabs[projectId] ?? { paths: [], active: null }
      commitTabs(projectId, { ...cur, active: path })
    },
    requestCloseTab: (projectId, path) => {
      const f = get().files[fileKey(path)]
      if (f?.kind === 'ready' && f.dirty) set({ closeRequest: { projectId, path } })
      else get().closeTab(projectId, path)
    },
    closeTab: (projectId, path) => {
      const cur = get().tabs[projectId]
      if (!cur) return
      const k = fileKey(path)
      const idx = cur.paths.findIndex(p => fileKey(p) === k)
      const paths = cur.paths.filter(p => fileKey(p) !== k)
      // Like Rider: closing the active tab activates its left neighbour.
      const active = cur.active && fileKey(cur.active) === k ? (paths[Math.max(0, idx - 1)] ?? null) : cur.active
      commitTabs(projectId, { paths, active })
      set((st) => ({ closeRequest: st.closeRequest && fileKey(st.closeRequest.path) === k ? null : st.closeRequest }))
    },
    cancelClose: () => set({ closeRequest: null }),
    setFileStatus: (path, s) => set((st) => ({ files: { ...st.files, [fileKey(path)]: s } })),

    toggleBreakpoint: (path, line) => {
      const cur = get().breakpoints[fileKey(path)]?.lines ?? []
      get().setBreakpointLines(path, cur.includes(line) ? cur.filter(l => l !== line) : [...cur, line])
    },
    setBreakpointLines: (path, lines) => {
      const k = fileKey(path)
      const prev = get().breakpoints[k]?.lines ?? []
      const uniq = [...new Set(lines)].sort((a, b) => a - b)
      if (uniq.length === prev.length && uniq.every((l, i) => l === prev[i])) return
      commit({ breakpoints: { [k]: uniq.length ? { path, lines: uniq } : null } })
    },
    clearAllBreakpoints: () => {
      commit({ breakpoints: Object.fromEntries(Object.keys(get().breakpoints).map(k => [k, null])) })
    },

    setBottomHeight: (px, done = true) => {
      if (done) commit({ bottomHeight: clampBottom(px) })
      else set({ bottomHeight: clampBottom(px) })
    },
    setTreeWidth: (px, done = true) => {
      if (done) commit({ treeWidth: clampTree(px) })
      else set({ treeWidth: clampTree(px) })
    },
    toggleTree: () => commit({ treeOpen: !get().treeOpen }),
    setDebugOpen: (open) => set({ debugOpen: open })
  }
})
