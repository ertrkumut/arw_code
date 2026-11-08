import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useIde } from '../store/ideStore'
import { getTheme, type TerminalPalette } from '../themes'
import { useApp } from '../store/appStore'
import { useZoom, attachWheelZoom } from '../store/zoomStore'
import type { AgentId } from '@shared/agents'
import '@xterm/xterm/css/xterm.css'

function xtermTheme(t: TerminalPalette) {
  const { selection, ...rest } = t
  return { ...rest, cursorAccent: t.background, selectionBackground: selection }
}

/** `session` overrides how a Claude terminal starts (used by a chat pane's terminal mode). */
export function useTerminalIO(id: string, cwd: string, agent?: AgentId, session?: { resume?: string; sessionId?: string }) {
  const elRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: useZoom.getState().term, lineHeight: 1.35, fontWeight: 400, fontWeightBold: 600,
      cursorBlink: true,
      theme: xtermTheme(getTheme(useIde.getState().themeId).terminal)
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(elRef.current!)
    // Follow theme switches live.
    const offTheme = useIde.subscribe((st, prev) => {
      if (st.themeId !== prev.themeId) term.options.theme = xtermTheme(getTheme(st.themeId).terminal)
    })

    let disposed = false

    // Only fit when the pane is actually laid out. A 0-sized element (e.g. a
    // background project rendered display:none) would otherwise make xterm snap
    // to its 80x24 default and push a bogus resize to the shell. Returns true
    // when a fit was applied so the caller knows whether to notify the PTY.
    const safeFit = () => {
      const el = elRef.current
      if (disposed || !el || el.clientWidth === 0 || el.clientHeight === 0) return false
      try { fit.fit() } catch { return false }
      return true
    }
    safeFit()

    // Ctrl/Cmd+V pastes, Ctrl/Cmd+C copies the selection (falling back to ^C
    // SIGINT when nothing is selected), Shift/Alt+Enter inserts a newline.
    // Returning false stops xterm from also forwarding the keystroke to the
    // shell. Shift+Insert pastes too.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if ((mod && key === 'v') || (e.shiftKey && key === 'insert')) {
        // preventDefault is essential: without it the browser still fires its
        // native `paste` event into xterm's hidden textarea, so xterm pastes a
        // SECOND time on top of our manual term.paste — the double-paste bug.
        e.preventDefault()
        void (async () => {
          const text = await window.arw.clipboardRead()
          if (text) { term.paste(text); return }
          // Image-only clipboard: keep a thumbnail on the pane, then hand the CLI its
          // own image-paste key so it attaches the picture. Claude Code on Windows
          // listens for Alt+V (ESC v); the other CLIs take a raw Ctrl+V.
          const img = await window.arw.clipboardReadImage()
          if (!img) return
          useApp.getState().addImage(id, img)
          window.arw.input(id, (agent ?? 'claude') === 'claude' ? '\x1bv' : '\x16')
        })()
        return false
      }
      // Alt+V is Claude Code's own image paste — let it through untouched, but grab
      // the same clipboard image for the pane's thumbnail strip.
      if (e.altKey && !mod && key === 'v') {
        window.arw.clipboardReadImage().then((img) => { if (img) useApp.getState().addImage(id, img) })
        return true
      }
      // Shift+Enter (and Alt+Enter, the chord Claude Code uses on macOS) insert
      // a newline instead of submitting. xterm drops the modifier and sends a
      // carriage return, which every agent CLI reads as "run it" — a bare line
      // feed is the other half of that pair, so the TUI's input box just grows
      // by one empty line and nothing is echoed. preventDefault keeps the
      // browser from also dropping a newline into xterm's hidden textarea.
      // Plain shells bind LF to accept-line too, so this only does something
      // useful once an agent is running — which is where it's wanted.
      if (key === 'enter' && (e.shiftKey || e.altKey) && !mod) {
        e.preventDefault()
        window.arw.input(id, '\n')
        return false
      }
      // Ctrl+I opens the panel of images used in this terminal's session. (xterm would
      // otherwise send it as a Tab — the Tab key itself arrives as key 'tab', unaffected.)
      if (mod && key === 'i' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        useApp.getState().openAssets(id, cwd)
        return false
      }
      if (mod && key === 'c' && term.hasSelection()) {
        window.arw.clipboardWrite(term.getSelection())
        return false
      }
      return true
    })

    // A terminal opened from the history dialog continues that Claude session (one-shot:
    // later re-mounts hit the already-running pty, and a relaunch starts fresh).
    if (session) window.arw.spawn(id, cwd, term.cols, term.rows, agent, session.resume, session.sessionId)
    else window.arw.spawn(id, cwd, term.cols, term.rows, agent, useApp.getState().takeResume(id))

    // Auto-focus a freshly created terminal so the user can start typing without
    // clicking into the pane. Only fires for the terminal addTerminal just flagged
    // — restored-on-launch and reattached panes leave autoFocusTermId null, so they
    // never steal focus.
    if (useApp.getState().autoFocusTermId === id) {
      term.focus()
      useApp.getState().clearAutoFocus()
    }
    // The check above only catches focus requests that exist at mount (new terminals).
    // Subscribe so requests made later (Ctrl+1..9 selecting an already-mounted pane)
    // also pull focus into this pane's input.
    const unsubFocus = useApp.subscribe((s) => {
      if (s.autoFocusTermId === id && !disposed) {
        term.focus()
        useApp.getState().clearAutoFocus()
      }
    })

    term.onData((d) => {
      window.arw.input(id, d)
      // Enter sent the prompt, and its images with it — empty the thumbnail strip.
      // (A bracketed paste can carry \r too; that's text arriving, not a submit.)
      if (d.includes('\r') && !d.startsWith('\x1b[200~')) useApp.getState().clearPendingImages(id)
    })
    // Claude Code sets the window title to a summary of the current conversation
    // (and updates it on /resume). Use it as the pane name until the user renames it.
    if ((agent ?? 'claude') === 'claude') {
      term.onTitleChange((title) => useApp.getState().autoNameTerminal(id, title))
    }
    const offData = window.arw.onData(({ id: tid, data }) => { if (tid === id) term.write(data) })

    const refit = () => { if (safeFit()) window.arw.resize(id, term.cols, term.rows) }

    // Ctrl+wheel zooms this terminal's font; every terminal follows the shared
    // size, and the PTY is re-measured so the shell's columns match the new glyphs.
    const offWheel = elRef.current ? attachWheelZoom(elRef.current, 'term') : () => {}
    const offZoom = useZoom.subscribe((st, prev) => {
      if (st.term === prev.term) return
      term.options.fontSize = st.term
      refit()
    })

    // xterm sizes its grid from whatever glyph is available the instant it opens.
    // JetBrains Mono is a bundled web font that loads asynchronously, so the first
    // fit almost always measures the fallback monospace — a narrower glyph — and
    // hands the shell too many columns. Once the real (wider) font swaps in, every
    // line overflows the pane and the text is clipped. Re-fit and resize the PTY
    // as soon as the actual font is ready so the column count matches what's drawn.
    document.fonts.load("400 13px 'JetBrains Mono'")
      .catch(() => {})
      .then(() => document.fonts.ready)
      .then(() => { if (!disposed) refit() })

    // Coalesce bursts of layout changes (grid reflow, sidebar drag, maximize)
    // into one fit per frame so we don't spam the PTY with resizes.
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; refit() })
    })
    if (elRef.current) ro.observe(elRef.current)
    return () => {
      // Tear down only the *view*. The shell is killed explicitly (tile ✕,
      // project removal, torn-off window close, app quit) — never on unmount,
      // so a terminal can move between windows without losing its session.
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      offData()
      unsubFocus()
      offTheme()
      offWheel()
      offZoom()
      ro.disconnect()
      term.dispose()
    }
  }, [id, cwd, agent])

  return elRef
}
