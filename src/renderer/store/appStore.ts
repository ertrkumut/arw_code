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
