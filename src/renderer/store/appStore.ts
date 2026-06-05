import { create } from 'zustand'
import type { PersistedState, Project, Group, TermState, LayoutMode } from '@shared/types'
import { DEFAULT_SIDEBAR_PCT } from '@shared/constants'

const SIDEBAR_MIN_PCT = 15
const SIDEBAR_MAX_PCT = 45
const clampSidebar = (pct: number) =>
  Math.min(SIDEBAR_MAX_PCT, Math.max(SIDEBAR_MIN_PCT, Math.round(pct * 10) / 10))

interface AppState {
  projects: Project[]
  groups: Group[]
  selectedProjectId: string | null
  sidebarCollapsed: boolean
  sidebarWidthPct: number
  statuses: Record<string, TermState>   // terminalId -> state
  maximizedTermId: string | null        // transient: pane filling the grid area
  focusedTermId: string | null          // transient: the "selected" pane (drives Ctrl+W target)
  autoFocusTermId: string | null        // transient: a just-created pane to focus once it mounts
  // transient: a pending close awaiting confirmation (only set when the terminal is `working`)
  closeRequest: { projectId: string; termId: string; name: string } | null
  loaded: boolean
  load: () => Promise<void>
  persist: () => void
  selectProject: (id: string) => void
  addProject: (name: string, path: string) => void
  removeProject: (id: string) => void
  setProjectColor: (id: string, color: string | null) => void
  setProjectLayout: (id: string, layout: LayoutMode) => void
  addTerminal: (projectId: string) => void
  removeTerminal: (projectId: string, termId: string) => void
  // Close a terminal, but if Claude is `working` in it, stage a confirmation instead.
  requestRemoveTerminal: (projectId: string, termId: string) => void
  confirmClose: () => void
  cancelClose: () => void
  renameTerminal: (projectId: string, termId: string, name: string) => void
  setTerminalColor: (projectId: string, termId: string, color: string | null) => void
  moveTerminal: (projectId: string, termId: string, toIndex: number) => void
  setMaximized: (termId: string | null) => void
  setFocusedTerm: (termId: string | null) => void
  // Select a terminal AND request its xterm input focus (Ctrl+1..9). If a pane is
  // currently maximized, the maximized pane switches to this one so it stays visible.
  focusTerminal: (termId: string) => void
  clearAutoFocus: () => void
  detachTerminal: (termId: string) => void
  reattachTerminal: (termId: string) => void
  dropTerminal: (termId: string) => void
  setStatus: (termId: string, state: TermState) => void
  // groups
  addGroup: (name: string) => string
  removeGroup: (id: string) => void
  renameGroup: (id: string, name: string) => void
  setGroupColor: (id: string, color: string | null) => void
  toggleGroup: (id: string) => void
  moveProject: (projectId: string, groupId: string | null, toIndex: number) => void
  // sidebar
  toggleSidebar: () => void
  setSidebarWidth: (pct: number, commit?: boolean) => void
}

const uid = () => Math.random().toString(36).slice(2, 10)

export const useApp = create<AppState>((set, get) => ({
  projects: [], groups: [], selectedProjectId: null, sidebarCollapsed: false,
  sidebarWidthPct: DEFAULT_SIDEBAR_PCT, statuses: {},
  maximizedTermId: null, focusedTermId: null, autoFocusTermId: null, closeRequest: null, loaded: false,

  load: async () => {
    const s: PersistedState = await window.arw.loadStore()
    set({
      projects: s.projects,
      groups: s.groups ?? [],
      selectedProjectId: s.lastSelectedProjectId,
      sidebarCollapsed: !!s.sidebarCollapsed,
      sidebarWidthPct: clampSidebar(s.sidebarWidthPct ?? DEFAULT_SIDEBAR_PCT),
      loaded: true
    })
  },
  persist: () => {
    const { projects, groups, selectedProjectId, sidebarCollapsed, sidebarWidthPct } = get()
    // `detached` is session-only — strip it so a torn-off terminal returns to
    // the grid on next launch instead of vanishing.
    const cleanProjects = projects.map(p => ({
      ...p,
      terminals: p.terminals.map(({ detached, ...t }) => t)
    }))
    window.arw.saveStore({
      version: 2,
      lastSelectedProjectId: selectedProjectId,
      projects: cleanProjects,
      groups,
      sidebarCollapsed,
      sidebarWidthPct
    } satisfies PersistedState)
  },
  selectProject: (id) => { set({ selectedProjectId: id }); get().persist() },
  addProject: (name, path) => {
    set((st) => ({ projects: [...st.projects, { id: uid(), name, path, collapsed: false, terminals: [], groupId: null }] }))
    get().persist()
  },
  removeProject: (id) => {
    const proj = get().projects.find(p => p.id === id)
    proj?.terminals.forEach(t => window.arw.kill(t.id))   // explicit kill (no longer killed on unmount)
    set((st) => ({
      projects: st.projects.filter(p => p.id !== id),
      selectedProjectId: st.selectedProjectId === id ? null : st.selectedProjectId
    }))
    get().persist()
  },
  setProjectColor: (id, color) => {
    set((st) => ({ projects: st.projects.map(p => p.id === id ? { ...p, color: color ?? undefined } : p) }))
    get().persist()
  },
  setProjectLayout: (id, layout) => {
    set((st) => ({ projects: st.projects.map(p => p.id === id ? { ...p, layout } : p) }))
    get().persist()
  },
  addTerminal: (projectId) => {
    const id = uid()
    // Flag the new terminal for auto-focus + mark it the selected pane so the user
    // can type immediately. useTerminalIO consumes autoFocusTermId once it mounts.
    set((st) => ({
      projects: st.projects.map(p => p.id === projectId
        ? { ...p, terminals: [...p.terminals, { id, name: `terminal ${p.terminals.length + 1}`, order: p.terminals.length }] }
        : p),
      focusedTermId: id,
      autoFocusTermId: id
    }))
    get().persist()
  },
  removeTerminal: (projectId, termId) => {
    window.arw.kill(termId)   // explicit kill (no longer killed on unmount)
    set((st) => ({
      projects: st.projects.map(p => p.id === projectId
        ? { ...p, terminals: p.terminals.filter(t => t.id !== termId) } : p),
      maximizedTermId: st.maximizedTermId === termId ? null : st.maximizedTermId,
      focusedTermId: st.focusedTermId === termId ? null : st.focusedTermId,
      closeRequest: st.closeRequest?.termId === termId ? null : st.closeRequest
    }))
    get().persist()
  },
  requestRemoveTerminal: (projectId, termId) => {
    // Guard destructive close: if Claude is mid-task, stage a confirmation modal
    // instead of killing the shell. Otherwise close immediately.
    const { statuses, projects } = get()
    if (statuses[termId] === 'working') {
      const name = projects.find(p => p.id === projectId)
        ?.terminals.find(t => t.id === termId)?.name ?? 'this terminal'
      set({ closeRequest: { projectId, termId, name } })
    } else {
      get().removeTerminal(projectId, termId)
    }
  },
  confirmClose: () => {
    const req = get().closeRequest
    if (req) get().removeTerminal(req.projectId, req.termId)   // also clears closeRequest
  },
  cancelClose: () => set({ closeRequest: null }),
  renameTerminal: (projectId, termId, name) => {
    set((st) => ({ projects: st.projects.map(p => p.id === projectId
      ? { ...p, terminals: p.terminals.map(t => t.id === termId ? { ...t, name } : t) } : p) }))
    get().persist()
  },
  setTerminalColor: (projectId, termId, color) => {
    set((st) => ({ projects: st.projects.map(p => p.id === projectId
      ? { ...p, terminals: p.terminals.map(t => t.id === termId
          ? { ...t, color: color ?? undefined } : t) } : p) }))
    get().persist()
  },
  moveTerminal: (projectId, termId, toIndex) => {
    set((st) => ({ projects: st.projects.map(p => {
      if (p.id !== projectId) return p
      const ordered = [...p.terminals].sort((a, b) => a.order - b.order)
      const from = ordered.findIndex(t => t.id === termId)
      if (from === -1) return p
      const [moved] = ordered.splice(from, 1)
      const clamped = Math.max(0, Math.min(toIndex, ordered.length))
      ordered.splice(clamped, 0, moved)
      return { ...p, terminals: ordered.map((t, i) => ({ ...t, order: i })) }
    }) }))
    get().persist()
  },
  setMaximized: (termId) => set({ maximizedTermId: termId }),
  setFocusedTerm: (termId) => set({ focusedTermId: termId }),
  focusTerminal: (termId) => set((st) => ({
    focusedTermId: termId,
    autoFocusTermId: termId,
    // Keep the visible pane in sync when maximized; leave grid view untouched otherwise.
    maximizedTermId: st.maximizedTermId === null ? null : termId
  })),
  clearAutoFocus: () => set({ autoFocusTermId: null }),
  detachTerminal: (termId) => set((st) => ({
    maximizedTermId: st.maximizedTermId === termId ? null : st.maximizedTermId,
    projects: st.projects.map(p => ({
      ...p, terminals: p.terminals.map(t => t.id === termId ? { ...t, detached: true } : t)
    }))
  })),
  reattachTerminal: (termId) => set((st) => ({
    projects: st.projects.map(p => ({
      ...p, terminals: p.terminals.map(t => t.id === termId ? { ...t, detached: false } : t)
    }))
  })),
  dropTerminal: (termId) => {
    // The shell is already killed by the main process (torn-off window closed);
    // just remove the terminal from whichever project holds it.
    set((st) => ({
      maximizedTermId: st.maximizedTermId === termId ? null : st.maximizedTermId,
      projects: st.projects.map(p => ({ ...p, terminals: p.terminals.filter(t => t.id !== termId) }))
    }))
    get().persist()
  },
  setStatus: (termId, state) => set((st) => ({ statuses: { ...st.statuses, [termId]: state } })),

  // ---- groups ----
  addGroup: (name) => {
    const id = uid()
    set((st) => ({ groups: [...st.groups, { id, name, collapsed: false }] }))
    get().persist()
    return id
  },
  removeGroup: (id) => {
    set((st) => ({
      groups: st.groups.filter(g => g.id !== id),
      projects: st.projects.map(p => p.groupId === id ? { ...p, groupId: null } : p)
    }))
    get().persist()
  },
  renameGroup: (id, name) => {
    set((st) => ({ groups: st.groups.map(g => g.id === id ? { ...g, name } : g) }))
    get().persist()
  },
  setGroupColor: (id, color) => {
    set((st) => ({ groups: st.groups.map(g => g.id === id ? { ...g, color: color ?? undefined } : g) }))
    get().persist()
  },
  toggleGroup: (id) => {
    set((st) => ({ groups: st.groups.map(g => g.id === id ? { ...g, collapsed: !g.collapsed } : g) }))
    get().persist()
  },
  moveProject: (projectId, groupId, toIndex) => {
    set((st) => {
      const moving = st.projects.find(p => p.id === projectId)
      if (!moving) return st
      const rest = st.projects.filter(p => p.id !== projectId)
      const updated: Project = { ...moving, groupId }
      const destPositions = rest
        .map((p, i) => (p.groupId === groupId ? i : -1))
        .filter(i => i !== -1)
      const clamped = Math.max(0, Math.min(toIndex, destPositions.length))
      const insertAt = clamped < destPositions.length ? destPositions[clamped] : rest.length
      return { projects: [...rest.slice(0, insertAt), updated, ...rest.slice(insertAt)] }
    })
    get().persist()
  },

  // ---- sidebar ----
  toggleSidebar: () => {
    set((st) => ({ sidebarCollapsed: !st.sidebarCollapsed }))
    get().persist()
  },

  // Live drag updates pass commit=false (no disk write); release commits + persists.
  setSidebarWidth: (pct, commit = true) => {
    set({ sidebarWidthPct: clampSidebar(pct) })
    if (commit) get().persist()
  }
}))
