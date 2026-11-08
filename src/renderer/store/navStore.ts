import { create } from 'zustand'
import type { IndexStatus } from '../../main/codeIndex'
import type { FindMatch } from '../../main/findInFiles'

/** IDE window UI state for navigation: popups, the Find tool window, history, caret info. */

export interface Loc { path: string; line: number; col: number }

export interface PopupItem {
  id: string
  label: string
  /** dimmed text after the label (container, path…) */
  detail?: string
  /** right-aligned hint (file:line, shortcut) */
  hint?: string
  /** symbol kind / icon key */
  icon?: string
  depth?: number
  /** header rows group the list and can't be picked */
  header?: boolean
  /** highlighted range in the label */
  mark?: [number, number]
  onPick?: () => void
}

export type SearchTab = 'all' | 'classes' | 'files' | 'symbols' | 'actions'

export type Popup =
  | { type: 'search'; tab: SearchTab; query?: string }
  | { type: 'list'; title: string; items: PopupItem[]; anchor?: { x: number; y: number }; filter?: boolean; footer?: { label: string; onClick: () => void }; initialIndex?: number; releaseCtrlPicks?: boolean; empty?: string }
  | { type: 'rename'; title: string; name: string; occurrences: { path: string; line: number; col: number; len: number }[]; files: number }
  | { type: 'settings'; tab: 'keymap' | 'editor' }

export interface FindItem extends FindMatch { decl?: boolean }

export interface FindPanelState {
  mode: 'usages' | 'text'
  title: string
  items: FindItem[]
  /** Find in Files query state, so the panel can re-run / replace */
  query?: { text: string; regex: boolean; matchCase: boolean; wholeWord: boolean; mask: string; replace?: string }
  showReplace?: boolean
  busy?: boolean
  error?: string
  truncated?: boolean
}

interface NavState {
  popup: Popup | null
  find: FindPanelState | null
  findOpen: boolean
  /** bottom tool window tab when both Find and Debug are available */
  bottomTab: 'find' | 'debug'
  history: Loc[]
  historyIndex: number
  recent: string[]
  closed: string[]
  index: IndexStatus | null
  /** caret position + symbol path ("Namespace", "Type", "Member") for the breadcrumbs / status bar */
  caret: { line: number; col: number; selection: number; symbols: { name: string; kind: string; line: number; col: number }[] } | null
  /** encoding / EOL of the active buffer */
  fileInfo: { eol: 'LF' | 'CRLF'; bom: boolean; language: string; tabSize: number; insertSpaces: boolean } | null
  /** asks the project tree to select a file */
  selectInTree: { path: string; nonce: number } | null

  open: (p: Popup) => void
  close: () => void
  showFind: (f: FindPanelState) => void
  setFind: (f: Partial<FindPanelState>) => void
  setFindOpen: (open: boolean) => void
  pushHistory: (l: Loc) => void
  touchRecent: (path: string) => void
  noteClosed: (path: string) => void
}

const sameLoc = (a: Loc, b: Loc) => a.path.toLowerCase() === b.path.toLowerCase() && Math.abs(a.line - b.line) < 3

export const useNav = create<NavState>((set, get) => ({
  popup: null, find: null, findOpen: false, bottomTab: 'find', history: [], historyIndex: -1, recent: [], closed: [],
  index: null, caret: null, fileInfo: null, selectInTree: null,

  open: (p) => set({ popup: p }),
  close: () => set({ popup: null }),
  showFind: (f) => set({ find: f, findOpen: true, bottomTab: 'find' }),
  setFind: (f) => set((st) => ({ find: st.find ? { ...st.find, ...f } : null })),
  setFindOpen: (open) => set({ findOpen: open, bottomTab: open ? 'find' : get().bottomTab }),
  pushHistory: (l) => set((st) => {
    const h = st.history.slice(0, st.historyIndex + 1)
    if (h.length && sameLoc(h[h.length - 1], l)) h[h.length - 1] = l
    else h.push(l)
    while (h.length > 100) h.shift()
    return { history: h, historyIndex: h.length - 1 }
  }),
  touchRecent: (path) => set((st) => ({ recent: [path, ...st.recent.filter(p => p.toLowerCase() !== path.toLowerCase())].slice(0, 50) })),
  noteClosed: (path) => set((st) => ({ closed: [path, ...st.closed.filter(p => p.toLowerCase() !== path.toLowerCase())].slice(0, 30) }))
}))
