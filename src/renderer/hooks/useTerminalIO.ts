import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { oceanic } from '../theme'
import '@xterm/xterm/css/xterm.css'

export function useTerminalIO(id: string, cwd: string) {
  const elRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'Consolas, monospace', fontSize: 13, cursorBlink: true,
      theme: { background: oceanic.bgDeep, foreground: oceanic.textSecondary }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(elRef.current!)
    fit.fit()

    window.arw.spawn(id, cwd, term.cols, term.rows)
    term.onData((d) => window.arw.input(id, d))
    const offData = window.arw.onData(({ id: tid, data }) => { if (tid === id) term.write(data) })

    const onResize = () => { fit.fit(); window.arw.resize(id, term.cols, term.rows) }
    window.addEventListener('resize', onResize)
    return () => {
      offData()
      window.removeEventListener('resize', onResize)
      window.arw.kill(id)
      term.dispose()
    }
  }, [id, cwd])

  return elRef
}
