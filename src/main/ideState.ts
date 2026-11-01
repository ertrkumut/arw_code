import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

/**
 * Editor/IDE state (theme, breakpoints, open tabs per project, panel sizes), kept in its
 * own file next to the app state. Several windows edit it (main window: theme; each
 * project's IDE window: its tabs and breakpoints), so main owns the one copy and windows
 * send *patches* that are merged key by key — no window can clobber another's changes.
 */
export interface IdePatch {
  themeId?: string
  bottomHeight?: number
  treeWidth?: number
  treeOpen?: boolean
  /** projectId -> that project's tabs (null drops it) */
  tabs?: Record<string, { paths: string[]; active: string | null } | null>
  /** fileKey -> breakpoints of that file (null removes the file) */
  breakpoints?: Record<string, { path: string; lines: number[] } | null>
}

export type IdeStateData = Required<Omit<IdePatch, 'tabs' | 'breakpoints'>> & {
  version: 1
  tabs: Record<string, { paths: string[]; active: string | null }>
  breakpoints: Record<string, { path: string; lines: number[] }>
}

export function emptyIdeState(): IdeStateData {
  return { version: 1, themeId: 'oceanic', bottomHeight: 280, treeWidth: 280, treeOpen: true, tabs: {}, breakpoints: {} }
}

/** Pure merge (exported for tests). */
export function applyIdePatch(s: IdeStateData, p: IdePatch): IdeStateData {
  const next: IdeStateData = { ...s, tabs: { ...s.tabs }, breakpoints: { ...s.breakpoints } }
  if (p.themeId !== undefined) next.themeId = p.themeId
  if (p.bottomHeight !== undefined) next.bottomHeight = p.bottomHeight
  if (p.treeWidth !== undefined) next.treeWidth = p.treeWidth
  if (p.treeOpen !== undefined) next.treeOpen = p.treeOpen
  for (const [k, v] of Object.entries(p.tabs ?? {})) { if (v) next.tabs[k] = v; else delete next.tabs[k] }
  for (const [k, v] of Object.entries(p.breakpoints ?? {})) { if (v && v.lines.length) next.breakpoints[k] = v; else delete next.breakpoints[k] }
  return next
}

/** Add a file to a project's tabs and make it active (used when the main window opens a file). */
export function openTabPatch(s: IdeStateData, projectId: string, path: string, key: (p: string) => string): IdePatch {
  const cur = s.tabs[projectId] ?? { paths: [], active: null }
  const existing = cur.paths.find(p => key(p) === key(path))
  return { tabs: { [projectId]: { paths: existing ? cur.paths : [...cur.paths, path], active: existing ?? path } } }
}

function file(): string {
  const { app } = require('electron') as typeof import('electron')
  return join(app.getPath('userData'), 'arw-ide-state.json')
}

let state: IdeStateData | null = null

export function getIdeState(): IdeStateData {
  if (state) return state
  state = emptyIdeState()
  try {
    const f = file()
    if (existsSync(f)) state = { ...state, ...JSON.parse(readFileSync(f, 'utf8')), version: 1 }
  } catch { /* corrupt — start fresh */ }
  return state!
}

let timer: NodeJS.Timeout | null = null
export function patchIdeState(p: IdePatch): IdeStateData {
  state = applyIdePatch(getIdeState(), p)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    try { writeFileSync(file(), JSON.stringify(state, null, 2)) } catch { /* disk full / locked — next save retries */ }
  }, 300)
  return state
}
