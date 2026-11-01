import { create } from 'zustand'
import { applyEvent, chatFromTranscript, emptyChat, type ChatState } from '@shared/chatModel'
import { useApp } from './appStore'

/**
 * Chats of Claude panes, keyed by terminal id. Every window that shows a chat (main grid
 * or a torn-off window) folds the same broadcast events into its own copy.
 */
interface ChatStore {
  chats: Record<string, ChatState>
  /** termId -> open() in flight / done */
  opened: Record<string, boolean>
  open: (termId: string, cwd: string, resume?: string) => Promise<void>
  send: (termId: string, text: string, images: string[]) => Promise<void>
  interrupt: (termId: string) => void
  clear: (termId: string) => Promise<void>
  /** Panes showing the real `claude` terminal instead of the chat, with how it starts. */
  terminal: Record<string, { resume?: string; sessionId?: string; command?: string }>
  enterTerminal: (termId: string, command?: string) => Promise<void>
  exitTerminal: (termId: string) => Promise<void>
  /** Slash commands last reported by Claude (shared by all panes; cached across launches). */
  catalog: { commands: string[]; terminal: string[] }
}

const dataUrlBlock = (url: string) => {
  const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(url)
  return m ? { type: 'image' as const, source: { type: 'base64' as const, media_type: m[1], data: m[2] } } : null
}

let wired = false

const CATALOG_KEY = 'arw.slashCatalog'
const loadCatalog = (): { commands: string[]; terminal: string[] } => {
  try { const c = JSON.parse(localStorage.getItem(CATALOG_KEY) ?? ''); if (Array.isArray(c.commands)) return c } catch { /* none yet */ }
  return { commands: [], terminal: [] }
}

export const useChat = create<ChatStore>((set, get) => {
  const wire = () => {
    if (wired) return
    wired = true
    window.arw.chat.onEvent(({ id, event }) => {
      const cur = get().chats[id]
      if (!cur) return                                    // not shown in this window
      const next = applyEvent(cur, event)
      if (next !== cur) set((st) => ({ chats: { ...st.chats, [id]: next } }))
      if (event?.type === 'system' && event.subtype === 'init' && Array.isArray(event.slash_commands)) {
        const catalog = { commands: event.slash_commands, terminal: event.terminal_slash_commands ?? [] }
        set({ catalog })
        try { localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog)) } catch { /* storage off */ }
      }

      const app = useApp.getState()
      if (event?.type === 'system' && event.subtype === 'init' && event.session_id) app.setTerminalSession(id, event.session_id)
      if (event?.type === 'arw_user') app.setStatus(id, 'working')
      if (event?.type === 'result') app.setStatus(id, event.subtype === 'success' || event.subtype === 'error_during_execution' ? 'idle' : 'error')
      if (event?.type === 'arw_exit' && event.text) app.setStatus(id, 'error')
    })
  }

  return {
    chats: {},
    opened: {},
    terminal: {},
    catalog: loadCatalog(),

    enterTerminal: async (termId, command) => {
      if (get().terminal[termId]) return
      const r = await window.arw.chat.suspend(termId)
      if (!r) return
      set((st) => ({ terminal: { ...st.terminal, [termId]: r.resume ? { resume: r.sessionId, command } : { sessionId: r.sessionId, command } } }))
    },
    exitTerminal: async (termId) => {
      if (!get().terminal[termId]) return
      // Always leave terminal mode, even if main couldn't tidy up the pty.
      let r: { sessionId: string; transcript: string } | null = null
      try { r = await window.arw.chat.returnFromTerminal(termId) } catch { /* fall through */ }
      set((st) => {
        const { [termId]: _, ...rest } = st.terminal
        if (!r) return { terminal: rest }
        // Whatever happened in the terminal is in the transcript now — rebuild from it.
        const cur = st.chats[termId] ?? emptyChat()
        const hist = r.transcript ? chatFromTranscript(r.transcript) : emptyChat()
        return { terminal: rest, chats: { ...st.chats, [termId]: { ...cur, ...hist, model: cur.model ?? hist.model,
          slashCommands: cur.slashCommands, terminalCommands: cur.terminalCommands, sessionId: r.sessionId } } }
      })
      if (r) useApp.getState().setTerminalSession(termId, r.sessionId)
    },

    open: async (termId, cwd, resume) => {
      wire()
      if (get().opened[termId]) return
      set((st) => ({ opened: { ...st.opened, [termId]: true }, chats: { ...st.chats, [termId]: st.chats[termId] ?? emptyChat() } }))
      try {
        const r = await window.arw.chat.open(termId, cwd, resume)
        const history = r.transcript ? chatFromTranscript(r.transcript) : emptyChat()
        // Keep anything that streamed in while the transcript loaded.
        set((st) => {
          const live = st.chats[termId] ?? emptyChat()
          const ids = new Set(history.items.map(i => i.id))
          return { chats: { ...st.chats, [termId]: {
            ...live,
            sessionId: r.sessionId,
            model: live.model ?? history.model,
            items: [...history.items, ...live.items.filter(i => !ids.has(i.id))]
          } } }
        })
        useApp.getState().setTerminalSession(termId, r.sessionId)
      } catch (e: any) {
        set((st) => ({ chats: { ...st.chats, [termId]: applyEvent(st.chats[termId] ?? emptyChat(), { type: 'arw_notice', tone: 'error', text: `Couldn't open the chat: ${e?.message ?? e}` }) } }))
      }
    },

    send: async (termId, text, images) => {
      const t = text.trim()
      if (!t && !images.length) return
      if (/^\/clear\s*$/i.test(t)) return get().clear(termId)
      // Commands that need Claude's interactive screens run in the pane's terminal mode.
      const cmd = /^\/([\w:.-]+)/.exec(t)?.[1]
      if (cmd && !images.length && isTerminalCommand(cmd, get().catalog.terminal)) return get().enterTerminal(termId, t)
      const content = [
        ...images.map(dataUrlBlock).filter((b): b is NonNullable<typeof b> => !!b),
        ...(t ? [{ type: 'text' as const, text: t }] : [])
      ]
      useApp.getState().namePaneFromPrompt(termId, t)
      window.arw.chat.send(termId, content, { text: t, images })
    },

    interrupt: (termId) => window.arw.chat.interrupt(termId),

    clear: async (termId) => {
      const r = await window.arw.chat.reset(termId)
      set((st) => ({ chats: { ...st.chats, [termId]: { ...emptyChat(), sessionId: r?.sessionId ?? null, model: st.chats[termId]?.model ?? null } } }))
      if (r) useApp.getState().setTerminalSession(termId, r.sessionId)
      useApp.getState().setStatus(termId, 'idle')
    }
  }
})

/**
 * Commands with interactive screens (menus, pickers, editors) that the headless chat can't
 * show. Claude lists a few itself (`terminal_slash_commands`); the rest are known TUIs.
 */
const TERMINAL_ONLY = new Set(['mcp', 'config', 'settings', 'login', 'logout', 'resume', 'permissions', 'allowed-tools', 'hooks',
  'memory', 'doctor', 'status', 'ide', 'terminal-setup', 'vim', 'theme', 'export', 'plugin', 'plugins', 'agents',
  'statusline', 'color', 'focus', 'reload-plugins', 'bashes', 'tasks', 'rewind', 'add-dir', 'privacy-settings', 'upgrade'])

export function isTerminalCommand(name: string, reported: string[] = []): boolean {
  const n = name.toLowerCase()
  return TERMINAL_ONLY.has(n) || reported.includes(n)
}

/** Short descriptions for the built-in commands (skills / MCP prompts show their name only). */
export const COMMAND_HELP: Record<string, string> = {
  clear: 'Start a new conversation', compact: 'Summarize the conversation to free up context',
  context: 'Show context usage', cost: 'Show usage and cost', usage: 'Show plan usage', model: 'Change the model (e.g. /model sonnet)',
  mcp: 'Manage MCP servers', config: 'Open settings', init: 'Create a CLAUDE.md for this project', review: 'Review a pull request',
  'security-review': 'Security review of pending changes', 'code-review': 'Review the current changes', agents: 'Manage subagents',
  memory: 'Edit Claude memory files', permissions: 'Manage tool permissions', hooks: 'Manage hooks', login: 'Sign in',
  logout: 'Sign out', doctor: 'Check the Claude Code install', status: 'Account and system status', resume: 'Resume a past conversation',
  export: 'Export the conversation', plugin: 'Manage plugins', effort: 'Set thinking effort', fast: 'Toggle fast mode',
  rename: 'Rename the conversation', recap: 'Recap the conversation', 'output-style': 'Change the output style',
  ide: 'Connect to an IDE', 'add-dir': 'Add a working directory', rewind: 'Rewind the conversation', statusline: 'Set up the status line',
  loop: 'Run a prompt on an interval', schedule: 'Schedule a cloud agent', insights: 'Session insights', simplify: 'Clean up changed code'
}
