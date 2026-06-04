import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { oceanic } from '../theme'
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
    fit.fit()

    window.arw.spawn(id, cwd, term.cols, term.rows)
    term.onData((d) => window.arw.input(id, d))
    const offData = window.arw.onData(({ id: tid, data }) => { if (tid === id) term.write(data) })

    const refit = () => { fit.fit(); window.arw.resize(id, term.cols, term.rows) }
    const ro = new ResizeObserver(() => refit())
    if (elRef.current) ro.observe(elRef.current)
    return () => {
      // Tear down only the *view*. The shell is killed explicitly (tile ✕,
      // project removal, torn-off window close, app quit) — never on unmount,
      // so a terminal can move between windows without losing its session.
      offData()
      ro.disconnect()
      term.dispose()
    }
  }, [id, cwd])

  return elRef
}
