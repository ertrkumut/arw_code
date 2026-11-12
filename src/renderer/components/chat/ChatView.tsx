import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useChat, COMMAND_HELP, isTerminalCommand, CODEX_COMMAND_HELP, isCodexTerminalCommand } from '../../store/chatStore'
import { useApp } from '../../store/appStore'
import { useZoom, attachWheelZoom } from '../../store/zoomStore'
import { emptyChat, formatDuration, type ChatItem } from '@shared/chatModel'
import { Markdown } from './Markdown'
import { ToolCard } from './ToolCard'
import { ChatDialogs } from './ChatDialogs'
import { UsageBar } from './UsageBar'
import { ImageStrip } from '../ImageStrip'
import { fuzzyScore } from '../../ide/fuzzy'
import { FileIcon } from '../FileIcons'
import { baseName } from '../../ide/paths'
import type { AgentId } from '@shared/agents'

type Tool = Extract<ChatItem, { kind: 'tool' }>
const NONE: string[] = []

function Thinking({ text, ms }: { text: string; ms?: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`ch-think${open ? ' open' : ''}`}>
      <div className="ch-think-row" onClick={() => setOpen(!open)}>
        <span className="ch-tool-chev">{open ? '▾' : '▸'}</span>
        Thought{ms ? ` for ${formatDuration(ms)}` : ''}
      </div>
      {open && <div className="ch-think-body">{text}</div>}
    </div>
  )
}

/** Live "working" line with a running timer. */
function Working({ since, thinking }: { since: number | null; thinking: string }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t) }, [])
  return (
    <div className="ch-working">
      <span className="ch-dots"><i /><i /><i /></span>
      <span>{thinking ? 'Thinking' : 'Working'}{since ? ` · ${formatDuration(Date.now() - since)}` : ''}</span>
      <span className="ch-working-hint">Esc to stop</span>
    </div>
  )
}

/** @-mention popup: project files matching what's typed after "@". */
function useFileIndex(cwd: string) {
  const [files, setFiles] = useState<string[] | null>(null)
  const load = () => { if (files === null) window.arw.fs.listFiles(cwd).then(setFiles).catch(() => setFiles([])) }
  return { files, load }
}

export function ChatView({ termId, cwd, project, resume, agent }: {
  termId: string
  cwd: string
  project: { id: string; name: string; path: string } | null
  resume?: string
  agent?: AgentId
}) {
  const codex = agent === 'codex'
  const who = codex ? 'Codex' : 'Claude'
  const chat = useChat(s => s.chats[termId]) ?? emptyChat()
  const pending = useApp(s => s.pendingImages[termId] ?? NONE)
  const [draft, setDraft] = useState('')
  const [mention, setMention] = useState<{ start: number; query: string; idx: number } | null>(null)
  const [slash, setSlash] = useState<{ query: string; idx: number } | null>(null)
  const catalog = useChat(s => s.catalog)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const index = useFileIndex(cwd)

  useEffect(() => { void useChat.getState().open(termId, cwd, resume, codex ? 'codex' : 'claude') }, [termId, cwd, resume, codex])

  // Ctrl+wheel zooms the chat text; the size drives every chat font via --ch-fs.
  const chatFs = useZoom(s => s.chat)
  useEffect(() => { const el = rootRef.current; return el ? attachWheelZoom(el, 'chat') : undefined }, [])

  // Focus requests (new pane, Ctrl+1..9) land in the prompt box.
  useEffect(() => {
    const take = () => {
      if (useApp.getState().autoFocusTermId !== termId) return
      inputRef.current?.focus()
      useApp.getState().clearAutoFocus()
    }
    take()
    return useApp.subscribe(take)
  }, [termId])

  // Stay pinned to the bottom while new output arrives, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat.items, chat.liveText, chat.liveThinking, chat.busy])
  const onScroll = () => {
    const el = listRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  // Grow the prompt box with its content (up to a cap).
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 220) + 'px'
  }, [draft])

  const openFile = (file: string, line?: number) => {
    if (project) window.arw.ide.open({ projectId: project.id, name: project.name, path: project.path, file, line })
  }

  // Sub-steps of Agent/Task tools are shown inside their parent card.
  const { top, childrenOf } = useMemo(() => {
    const childrenOf = new Map<string, Tool[]>()
    const top: ChatItem[] = []
    for (const it of chat.items) {
      const parent = (it as any).parent as string | undefined
      if (parent) {
        if (it.kind === 'tool') childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), it])
        continue
      }
      top.push(it)
    }
    return { top, childrenOf }
  }, [chat.items])

  const send = () => {
    const text = draft
    if (!text.trim() && !pending.length) return
    stick.current = true
    void useChat.getState().send(termId, text, pending)
    useApp.getState().clearPendingImages(termId)
    setDraft('')
    setMention(null)
  }

  const mentionResults = useMemo(() => {
    if (!mention || !index.files) return []
    const q = mention.query
    const pool = index.files
    if (!q) return pool.slice(0, 12)
    return pool.map(f => ({ f, s: fuzzyScore(q, f) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.f)
  }, [mention, index.files])

  // "/" palette: Claude's reported commands (skills, MCP prompts…) + the known built-ins.
  const slashResults = useMemo(() => {
    if (!slash) return []
    if (codex) {
      // Codex's own commands, in-chat ones first.
      const all = Object.keys(CODEX_COMMAND_HELP).filter(c => c !== 'clear')
      const q = slash.query.toLowerCase()
      return q
        ? all.map(c => ({ c, s: c.startsWith(q) ? 1000 - c.length : fuzzyScore(q, c) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).map(x => x.c)
        : all
    }
    const reported = chat.slashCommands.length ? chat.slashCommands : catalog.commands
    const all = [...new Set(['clear', 'compact', 'context', 'cost', 'model', 'mcp', ...Object.keys(COMMAND_HELP), ...reported])]
      .filter(c => !c.startsWith('__'))
    const q = slash.query.toLowerCase()
    const ranked = q
      ? all.map(c => ({ c, s: c.toLowerCase().startsWith(q) ? 1000 - c.length : fuzzyScore(q, c) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).map(x => x.c)
      : all.sort((a, b) => Number(!COMMAND_HELP[a]) - Number(!COMMAND_HELP[b]) || a.localeCompare(b))
    return ranked.slice(0, 40)
  }, [slash, chat.slashCommands, catalog.commands, codex])

  const pickSlash = (cmd: string) => {
    const text = `/${cmd} `
    setDraft(text)
    setSlash(null)
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(text.length, text.length) } })
  }

  const pickMention = (rel: string) => {
    if (!mention) return
    const before = draft.slice(0, mention.start)
    const after = draft.slice(mention.start + 1 + mention.query.length)
    const ins = `@${/\s/.test(rel) ? `"${rel}"` : rel} `
    setDraft(before + ins + after)
    setMention(null)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) { el.focus(); const pos = (before + ins).length; el.setSelectionRange(pos, pos) }
    })
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setDraft(v)
    // An "@" at a word start opens the file picker; the query runs to the caret.
    const caret = e.target.selectionStart ?? v.length
    const m = /(^|\s)@([^\s@]*)$/.exec(v.slice(0, caret))
    if (m) { index.load(); setMention({ start: caret - m[2].length - 1, query: m[2], idx: 0 }) }
    else setMention(null)
    // "/" as the first character opens the command palette until the first space.
    const sm = /^\/([^\s]*)$/.exec(v.slice(0, caret))
    setSlash(sm && caret === v.length ? { query: sm[1], idx: 0 } : null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (useChat.getState().dialog) return
    if (slash && slashResults.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlash({ ...slash, idx: Math.min(slashResults.length - 1, slash.idx + 1) }); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlash({ ...slash, idx: Math.max(0, slash.idx - 1) }); return }
      if (e.key === 'Tab') { e.preventDefault(); pickSlash(slashResults[slash.idx]); return }
      if (e.key === 'Enter' && !e.shiftKey) {
        // Enter runs the highlighted command right away (like the terminal).
        e.preventDefault()
        const cmd = `/${slashResults[slash.idx]}`
        setSlash(null)
        stick.current = true
        void useChat.getState().send(termId, cmd, [])
        setDraft('')
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setSlash(null); return }
    }
    if (mention && mentionResults.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMention({ ...mention, idx: Math.min(mentionResults.length - 1, mention.idx + 1) }); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMention({ ...mention, idx: Math.max(0, mention.idx - 1) }); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionResults[mention.idx]); return }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey) { e.preventDefault(); send(); return }
    if (e.key === 'Escape' && chat.busy) { e.preventDefault(); useChat.getState().interrupt(termId); return }
    // Ctrl+I: images used in this conversation.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); useApp.getState().openAssets(termId, cwd) }
  }

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = [...e.clipboardData.items].find(i => i.type.startsWith('image/'))?.getAsFile()
    if (!file) return
    e.preventDefault()
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file) })
    useApp.getState().addImage(termId, url)
  }

  const empty = top.length === 0 && !chat.busy

  return (
    <div className={`ch-root${codex ? ' ch-codex' : ''}`} ref={rootRef} style={{ '--ch-fs': `${chatFs}px` } as React.CSSProperties}
      onMouseDown={(e) => { if (e.target === e.currentTarget) inputRef.current?.focus() }}>
      <div className="ch-list scroll-slim" ref={listRef} onScroll={onScroll}>
        {empty && (
          <div className="ch-empty">
            <div className="ch-empty-title">What should we build?</div>
            <div className="ch-empty-sub">{who} works in <b>{baseName(cwd)}</b>. Type <kbd>@</kbd> to mention a file, paste images with <kbd>Ctrl+V</kbd>.</div>
          </div>
        )}
        {top.map(it => {
          switch (it.kind) {
            case 'user': return (
              <div key={it.id} className={`ch-user${/^\/[\w:.-]+/.test(it.text) ? ' cmd' : ''}`}>
                {it.images.length > 0 && (
                  <div className="ch-user-imgs">
                    {it.images.slice(0, 8).map((src, i) => (
                      <img key={i} src={src} alt="" onClick={() => useApp.getState().setLightbox(src, termId)} />
                    ))}
                  </div>
                )}
                {it.text && <div className="ch-user-text">{it.text}</div>}
              </div>
            )
            case 'text': return <Markdown key={it.id} text={it.text} className="md ch-text" />
            case 'thinking': return <Thinking key={it.id} text={it.text} ms={it.ms} />
            case 'tool': return <ToolCard key={it.id} tool={it} children={childrenOf.get(it.id)} onOpenFile={openFile} />
            case 'turn': return (
              <div key={it.id} className={`ch-turn${it.error ? ' err' : ''}`}>
                {it.stopped ? `Stopped after ${formatDuration(it.ms)}` : it.error ? `Error: ${it.error}` : `Worked for ${formatDuration(it.ms)}`}
              </div>
            )
            case 'notice': return <div key={it.id} className={`ch-notice ${it.tone}`}>{it.text}</div>
            case 'command': return <pre key={it.id} className="ch-cmd-out">{it.text}</pre>
            case 'compacted': return <div key={it.id} className="ch-turn">Conversation compacted</div>
          }
        })}
        {chat.busy && chat.liveThinking && <div className="ch-think live"><div className="ch-think-row">Thinking…</div><div className="ch-think-body">{chat.liveThinking.slice(-600)}</div></div>}
        {chat.busy && chat.liveText && <Markdown text={chat.liveText} className="md ch-text live" />}
        {chat.busy && <Working since={chat.turnStartedAt} thinking={chat.liveThinking} />}
      </div>

      <ChatDialogs termId={termId} cwd={cwd} />
      <div className="ch-composer">
        {slash && slashResults.length > 0 && (
          <div className="ch-mention">
            {slashResults.map((c, i) => (
              <div key={c} className={`goto-row${i === slash.idx ? ' active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pickSlash(c) }}>
                <span className="ch-slash-name">/{c}</span>
                <span className="goto-dir">{codex ? CODEX_COMMAND_HELP[c] : COMMAND_HELP[c] ?? (c.startsWith('mcp__') ? 'MCP prompt' : c.includes(':') ? 'Plugin skill' : 'Skill / command')}</span>
                {(codex ? isCodexTerminalCommand(c) : isTerminalCommand(c, chat.terminalCommands.length ? chat.terminalCommands : catalog.terminal))
                  && <span className="ch-slash-term" title={`Opens in the ${who} terminal`}>›_ terminal</span>}
              </div>
            ))}
          </div>
        )}
        {mention && index.files && (
          <div className="ch-mention">
            {mentionResults.length === 0 ? <div className="goto-empty">No matching files</div> : mentionResults.map((rel, i) => (
              <div key={rel} className={`goto-row${i === mention.idx ? ' active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pickMention(rel) }}>
                <FileIcon name={baseName(rel)} /><span className="goto-name">{baseName(rel)}</span>
                <span className="goto-dir">{rel.slice(0, -baseName(rel).length).replace(/\/$/, '')}</span>
              </div>
            ))}
          </div>
        )}
        <ImageStrip termId={termId} />
        <div className={`ch-input-box${chat.busy ? ' busy' : ''}`}>
          <textarea ref={inputRef} className="ch-input" rows={1} value={draft} spellCheck={false}
            placeholder={chat.busy ? `${who} is working — your message will be sent after this step` : `Ask ${who} anything, @ to mention a file`}
            onChange={onChange} onKeyDown={onKeyDown} onPaste={onPaste} />
          <div className="ch-input-bar">
            <span className="ch-model" title="Model">{codex ? `Codex${chat.model ? ' · ' + chat.model : ''}` : chat.model ?? 'Claude Code'}</span>
            <span style={{ flex: 1 }} />
            {chat.busy && (
              <button className="ch-stop" title="Stop (Esc)" onClick={() => useChat.getState().interrupt(termId)}>
                <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
              </button>
            )}
            <button className="ch-send" title="Send (Enter)" disabled={!draft.trim() && !pending.length} onClick={send}>
              <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 12V2M2.8 6.2L7 2l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
        <UsageBar chat={chat} codex={codex} />
      </div>
    </div>
  )
}
