import { create } from 'zustand'
import type { PersistedState, Project, Group, TermState } from '@shared/types'

interface AppState {
  projects: Project[]
  groups: Group[]
  selectedProjectId: string | null
  sidebarCollapsed: boolean
  statuses: Record<string, TermState>   // terminalId -> state
  maximizedTermId: string | null        // transient: pane filling the grid area
  loaded: boolean
  load: () => Promise<void>
  persist: () => void
  selectProject: (id: string) => void
  addProject: (name: string, path: string) => void
  removeProject: (id: string) => void
  addTerminal: (projectId: string) => void
  removeTerminal: (projectId: string, termId: string) => void
  renameTerminal: (projectId: string, termId: string, name: string) => void
  setTerminalColor: (projectId: string, termId: string, color: string | null) => void
  moveTerminal: (projectId: string, termId: string, toIndex: number) => void
  setMaximized: (termId: string | null) => void
  detachTerminal: (termId: string) => void
  reattachTerminal: (termId: string) => void
  dropTerminal: (termId: string) => void
  setStatus: (termId: string, state: TermState) => void
  // groups
  addGroup: (name: string) => string
  removeGroup: (id: string) => void
  renameGroup: (id: string, name: string) => void
  toggleGroup: (id: string) => void
  moveProject: (projectId: string, groupId: string | null, toIndex: number) => void
  // sidebar
  toggleSidebar: () => void
}

const uid = () => Math.random().toString(36).slice(2, 10)

export const useApp = create<AppState>((set, get) => ({
  projects: [], groups: [], selectedProjectId: null, sidebarCollapsed: false, statuses: {},
  maximizedTermId: null, loaded: false,

  load: async () => {
    const s: PersistedState = await window.arw.loadStore()
    set({
      projects: s.projects,
      groups: s.groups ?? [],
      selectedProjectId: s.lastSelectedProjectId,
      sidebarCollapsed: !!s.sidebarCollapsed,
      loaded: true
    })
  },
  persist: () => {
    const { projects, groups, selectedProjectId, sidebarCollapsed } = get()
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
      sidebarCollapsed
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
  addTerminal: (projectId) => {
    set((st) => ({ projects: st.projects.map(p => p.id === projectId
      ? { ...p, terminals: [...p.terminals, { id: uid(), name: `terminal ${p.terminals.length + 1}`, order: p.terminals.length }] }
      : p) }))
    get().persist()
  },
  removeTerminal: (projectId, termId) => {
    window.arw.kill(termId)   // explicit kill (no longer killed on unmount)
    set((st) => ({
      projects: st.projects.map(p => p.id === projectId
        ? { ...p, terminals: p.terminals.filter(t => t.id !== termId) } : p),
      maximizedTermId: st.maximizedTermId === termId ? null : st.maximizedTermId
    }))
    get().persist()
  },
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
  }
}))
