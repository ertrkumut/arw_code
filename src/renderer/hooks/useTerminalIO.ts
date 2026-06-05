import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { oceanic } from '../theme'
import { useApp } from '../store/appStore'
import '@xterm/xterm/css/xterm.css'

export function useTerminalIO(id: string, cwd: string) {
  const elRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 13, lineHeight: 1.35, fontWeight: 400, fontWeightBold: 600,
      cursorBlink: true,
      theme: {
        background: oceanic.bgTerminal,
        foreground: '#C8CEDE',
        cursor: oceanic.accent,
        cursorAccent: oceanic.bgTerminal,
        selectionBackground: oceanic.selection,
        black: oceanic.ansi.black, red: oceanic.ansi.red, green: oceanic.ansi.green, yellow: oceanic.ansi.yellow,
        blue: oceanic.ansi.blue, magenta: oceanic.ansi.magenta, cyan: oceanic.ansi.cyan, white: oceanic.ansi.white,
        brightBlack: oceanic.ansi.brightBlack, brightRed: oceanic.ansi.brightRed, brightGreen: oceanic.ansi.brightGreen,
        brightYellow: oceanic.ansi.brightYellow, brightBlue: oceanic.ansi.brightBlue, brightMagenta: oceanic.ansi.brightMagenta,
        brightCyan: oceanic.ansi.brightCyan, brightWhite: oceanic.ansi.brightWhite
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(elRef.current!)

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
    // SIGINT when nothing is selected). Returning false stops xterm from also
    // forwarding the keystroke to the shell. Shift+Insert pastes too.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if ((mod && key === 'v') || (e.shiftKey && key === 'insert')) {
        // preventDefault is essential: without it the browser still fires its
        // native `paste` event into xterm's hidden textarea, so xterm pastes a
        // SECOND time on top of our manual term.paste — the double-paste bug.
        e.preventDefault()
        window.arw.clipboardRead().then((text) => { if (text) term.paste(text) })
        return false
      }
      if (mod && key === 'c' && term.hasSelection()) {
        window.arw.clipboardWrite(term.getSelection())
        return false
      }
      return true
    })

    window.arw.spawn(id, cwd, term.cols, term.rows)

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

    term.onData((d) => window.arw.input(id, d))
    const offData = window.arw.onData(({ id: tid, data }) => { if (tid === id) term.write(data) })

    const refit = () => { if (safeFit()) window.arw.resize(id, term.cols, term.rows) }

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
      ro.disconnect()
      term.dispose()
    }
  }, [id, cwd])

  return elRef
}
