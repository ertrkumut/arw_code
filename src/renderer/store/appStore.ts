import { create } from 'zustand'
import type { PersistedState, Project, Group, TermState, LayoutMode } from '@shared/types'
import { DEFAULT_AGENT, toAgentId, type AgentId } from '@shared/agents'
import { DEFAULT_SIDEBAR_PCT, DEFAULT_EXPLORER_WIDTH } from '@shared/constants'
import { cleanAgentTitle, DEFAULT_NAME_RE } from '@shared/termTitle'

const SIDEBAR_MIN_PCT = 15
const SIDEBAR_MAX_PCT = 45
const clampExplorer = (px: number) => Math.min(640, Math.max(180, Math.round(px)))
const clampSidebar = (pct: number) =>
  Math.min(SIDEBAR_MAX_PCT, Math.max(SIDEBAR_MIN_PCT, Math.round(pct * 10) / 10))

interface AppState {
  projects: Project[]
  groups: Group[]
  selectedProjectId: string | null
  sidebarCollapsed: boolean
  sidebarWidthPct: number
  explorerOpen: boolean
  explorerWidth: number
  statuses: Record<string, TermState>   // terminalId -> state
  // Agent used for the most recent terminal — the default the picker and Ctrl+N open with.
  lastAgent: AgentId
  maximizedTermId: string | null        // transient: pane filling the grid area
  focusedTermId: string | null          // transient: the "selected" pane (drives Ctrl+W target)
  autoFocusTermId: string | null        // transient: a just-created pane to focus once it mounts
  // transient: a pending close awaiting confirmation (only set when the terminal is `working`)
  closeRequest: { projectId: string; termId: string; name: string } | null
  // transient: the conversation-history dialog is open for this project (null = closed)
  historyFor: { projectId: string } | null
  // transient: terminalId -> images pasted into it this session (PNG data URLs, oldest first)
  images: Record<string, string[]>
  // transient: terminalId -> images pasted for the prompt being typed (the thumbnail strip);
  // emptied when the prompt is sent
  pendingImages: Record<string, string[]>
  // transient: the Ctrl+I session-images panel is open for this terminal (null = closed)
  assetsFor: { termId: string; dir: string } | null
  // transient: image shown full-size over the app (null = closed)
  lightbox: string | null
  // transient: terminal the full-size image was opened from (its "use again" target)
  lightboxTerm: string | null
  // transient: terminalId -> Claude session id its shell should `--resume` on first spawn
  resumeSessions: Record<string, string>
  loaded: boolean
  load: () => Promise<void>
  persist: () => void
  selectProject: (id: string) => void
  addProject: (name: string, path: string) => void
  removeProject: (id: string) => void
  setProjectColor: (id: string, color: string | null) => void
  setProjectLayout: (id: string, layout: LayoutMode) => void
  // `agent` picks the CLI to launch; omitted falls back to the last-used one (Ctrl+N).
  addTerminal: (projectId: string, agent?: AgentId) => void
  openHistory: (projectId: string) => void
  closeHistory: () => void
  // Open a new Claude terminal in the project that continues a saved session.
  resumeSession: (projectId: string, sessionId: string, title: string) => void
  // Read-and-clear the pending resume id for a terminal (called once at spawn).
  takeResume: (termId: string) => string | undefined
  addImage: (termId: string, dataUrl: string) => void
  // Drop one thumbnail from the strip (the session history keeps it).
  removePendingImage: (termId: string, index: number) => void
  // The prompt was sent: empty the strip.
  clearPendingImages: (termId: string) => void
  clearImages: (termId: string) => void
  setLightbox: (dataUrl: string | null, termId?: string) => void
  openAssets: (termId: string, dir: string) => void
  closeAssets: () => void
  removeTerminal: (projectId: string, termId: string) => void
  // Close a terminal, but if Claude is `working` in it, stage a confirmation instead.
  requestRemoveTerminal: (projectId: string, termId: string) => void
  confirmClose: () => void
  cancelClose: () => void
  renameTerminal: (projectId: string, termId: string, name: string) => void
  /** Follow the CLI's window title, unless the user has named this terminal. */
  autoNameTerminal: (termId: string, rawTitle: string) => void
  setTerminalColor: (projectId: string, termId: string, color: string | null) => void
  /** A chat pane's Claude session (new conversation, or resumed id changed). */
  setTerminalSession: (termId: string, sessionId: string) => void
  /** Name a chat pane after its first prompt, unless the user renamed it. */
  namePaneFromPrompt: (termId: string, prompt: string) => void
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
  // file explorer (right side)
  toggleExplorer: () => void
  setExplorerWidth: (px: number, commit?: boolean) => void
}

const MAX_IMAGES = 12

const uid = () => Math.random().toString(36).slice(2, 10)

export const useApp = create<AppState>((set, get) => ({
  projects: [], groups: [], selectedProjectId: null, sidebarCollapsed: false,
  sidebarWidthPct: DEFAULT_SIDEBAR_PCT, explorerOpen: true, explorerWidth: DEFAULT_EXPLORER_WIDTH, statuses: {}, lastAgent: DEFAULT_AGENT,
  maximizedTermId: null, focusedTermId: null, autoFocusTermId: null, closeRequest: null,
  historyFor: null, images: {}, pendingImages: {}, assetsFor: null, lightbox: null, lightboxTerm: null, resumeSessions: {}, loaded: false,

  load: async () => {
    const s: PersistedState = await window.arw.loadStore()
    set({
      projects: s.projects,
      groups: s.groups ?? [],
      selectedProjectId: s.lastSelectedProjectId,
      sidebarCollapsed: !!s.sidebarCollapsed,
      sidebarWidthPct: clampSidebar(s.sidebarWidthPct ?? DEFAULT_SIDEBAR_PCT),
      lastAgent: toAgentId(s.lastAgent),
      explorerOpen: s.explorerOpen ?? true,
      explorerWidth: clampExplorer(s.explorerWidth ?? DEFAULT_EXPLORER_WIDTH),
      loaded: true
    })
  },
  persist: () => {
    const { projects, groups, selectedProjectId, sidebarCollapsed, sidebarWidthPct, lastAgent, explorerOpen, explorerWidth } = get()
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
      sidebarWidthPct,
      lastAgent,
      explorerOpen,
      explorerWidth
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
  addTerminal: (projectId, agent) => {
    const id = uid()
    // No explicit pick (Ctrl+N) reuses whatever the last terminal ran, so the
    // keyboard path never silently drops you back onto Claude.
    const pick = agent ?? get().lastAgent
    // Flag the new terminal for auto-focus + mark it the selected pane so the user
    // can type immediately. useTerminalIO consumes autoFocusTermId once it mounts.
    set((st) => ({
      projects: st.projects.map(p => p.id === projectId
        ? { ...p, terminals: [...p.terminals, { id, name: `terminal ${p.terminals.length + 1}`, order: p.terminals.length, agent: pick, autoName: true }] }
        : p),
      focusedTermId: id,
      autoFocusTermId: id,
      lastAgent: pick
    }))
    get().persist()
  },
  openHistory: (projectId) => set({ historyFor: { projectId } }),
  closeHistory: () => set({ historyFor: null }),
  resumeSession: (projectId, sessionId, title) => {
    const id = uid()
    const name = title.length > 40 ? title.slice(0, 39) + '…' : title
    set((st) => ({
      projects: st.projects.map(p => p.id === projectId
        ? { ...p, terminals: [...p.terminals, { id, name, order: p.terminals.length, agent: 'claude' as AgentId, autoName: true }] }
        : p),
      resumeSessions: { ...st.resumeSessions, [id]: sessionId },
      selectedProjectId: projectId,
      focusedTermId: id, autoFocusTermId: id,
      historyFor: null
    }))
    get().persist()
  },
  takeResume: (termId) => {
    const sid = get().resumeSessions[termId]
    if (sid) set((st) => {
      const { [termId]: _, ...rest } = st.resumeSessions
      return { resumeSessions: rest }
    })
    return sid
  },
  addImage: (termId, dataUrl) => set((st) => {
    const list = st.images[termId] ?? []
    const pending = st.pendingImages[termId] ?? []
    if (pending[pending.length - 1] === dataUrl) return st   // same clipboard pasted twice
    // Keep only the most recent few: each full-size screenshot is megabytes of base64.
    return {
      images: { ...st.images, [termId]: [...list, dataUrl].slice(-MAX_IMAGES) },
      pendingImages: { ...st.pendingImages, [termId]: [...pending, dataUrl] }
    }
  }),
  removePendingImage: (termId, index) => set((st) => ({
    pendingImages: { ...st.pendingImages, [termId]: (st.pendingImages[termId] ?? []).filter((_, i) => i !== index) }
  })),
  clearPendingImages: (termId) => set((st) => {
    if (!st.pendingImages[termId]) return st
    const { [termId]: _, ...rest } = st.pendingImages
    return { pendingImages: rest }
  }),
  clearImages: (termId) => set((st) => {
    const { [termId]: _, ...rest } = st.images
    const { [termId]: __, ...restPending } = st.pendingImages
    return { images: rest, pendingImages: restPending }
  }),
  setLightbox: (dataUrl, termId) => set({ lightbox: dataUrl, lightboxTerm: dataUrl ? termId ?? null : null }),
  openAssets: (termId, dir) => set({ assetsFor: { termId, dir } }),
  closeAssets: () => set({ assetsFor: null }),
  removeTerminal: (projectId, termId) => {
    window.arw.kill(termId)   // explicit kill (no longer killed on unmount)
    set((st) => ({
      projects: st.projects.map(p => p.id === projectId
        ? { ...p, terminals: p.terminals.filter(t => t.id !== termId) } : p),
      maximizedTermId: st.maximizedTermId === termId ? null : st.maximizedTermId,
      focusedTermId: st.focusedTermId === termId ? null : st.focusedTermId,
      closeRequest: st.closeRequest?.termId === termId ? null : st.closeRequest
    }))
    get().clearImages(termId)
    get().persist()
  },
  requestRemoveTerminal: (projectId, termId) => {
    // Guard destructive close: if Claude is mid-task, stage a confirmation modal
    // instead of killing the shell. Otherwise close immediately.
    const { statuses, projects } = get()
    const term = projects.find(p => p.id === projectId)?.terminals.find(t => t.id === termId)
    if (statuses[termId] === 'working') {
      set({ closeRequest: { projectId, termId, name: term?.name ?? 'this terminal' } })
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
      ? { ...p, terminals: p.terminals.map(t => t.id === termId ? { ...t, name, autoName: false } : t) } : p) }))
    get().persist()
  },
  autoNameTerminal: (termId, rawTitle) => {
    const name = cleanAgentTitle(rawTitle)
    if (!name) return
    const t = get().projects.flatMap(p => p.terminals).find(x => x.id === termId)
    // Not in this window's store (e.g. a torn-off window) — leave it to the main window.
    if (!t || t.name === name) return
    if (!(t.autoName ?? DEFAULT_NAME_RE.test(t.name))) return
    set((st) => ({ projects: st.projects.map(p => ({
      ...p, terminals: p.terminals.map(x => x.id === termId ? { ...x, name, autoName: true } : x)
    })) }))
    get().persist()
  },
  setTerminalColor: (projectId, termId, color) => {
    set((st) => ({ projects: st.projects.map(p => p.id === projectId
      ? { ...p, terminals: p.terminals.map(t => t.id === termId
          ? { ...t, color: color ?? undefined } : t) } : p) }))
    get().persist()
  },
  setTerminalSession: (termId, sessionId) => {
    const t = get().projects.flatMap(p => p.terminals).find(x => x.id === termId)
    if (!t || t.sessionId === sessionId) return
    set((st) => ({ projects: st.projects.map(p => ({
      ...p, terminals: p.terminals.map(x => x.id === termId ? { ...x, sessionId } : x)
    })) }))
    get().persist()
  },
  namePaneFromPrompt: (termId, prompt) => {
    const t = get().projects.flatMap(p => p.terminals).find(x => x.id === termId)
    if (!t || !(t.autoName ?? DEFAULT_NAME_RE.test(t.name)) || !DEFAULT_NAME_RE.test(t.name)) return
    const one = prompt.replace(/\s+/g, ' ').trim()
    if (!one) return
    const name = one.length > 40 ? one.slice(0, 39) + '…' : one
    set((st) => ({ projects: st.projects.map(p => ({
      ...p, terminals: p.terminals.map(x => x.id === termId ? { ...x, name, autoName: true } : x)
    })) }))
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
  },

  // ---- file explorer ----
  toggleExplorer: () => {
    set((st) => ({ explorerOpen: !st.explorerOpen }))
    get().persist()
  },
  setExplorerWidth: (px, commit = true) => {
    set({ explorerWidth: clampExplorer(px) })
    if (commit) get().persist()
  }
}))
