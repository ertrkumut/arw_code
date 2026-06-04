import React, { useEffect, useState } from 'react'
import { useTerminalIO } from './hooks/useTerminalIO'
import { Dot } from './components/Dot'
import { oceanic } from './theme'
import type { TermState } from '@shared/types'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * The single-terminal view shown in a torn-off window. The shell already runs
 * in the main process (spawn is idempotent), so mounting here just attaches a
 * fresh xterm to the live pty. Dragging the grip back over the main window
 * reattaches; closing the OS window kills the shell (handled in the main process).
 */
export function DetachedTerminalApp({ termId, name, color, cwd }: { termId: string; name: string; color?: string; cwd: string }) {
  const elRef = useTerminalIO(termId, cwd)
  const [state, setState] = useState<TermState>('idle')

  useEffect(() => {
    document.title = name
    const off = window.arw.onStatus(({ id, state }) => { if (id === termId) setState(state as TermState) })
    return () => { off() }
  }, [termId, name])

  const onGripDown = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', up)
      window.arw.reattach({ termId, screenX: ev.screenX, screenY: ev.screenY })
    }
    window.addEventListener('pointerup', up)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: oceanic.bgTerminal,
      ...(color ? { ['--pane-accent']: color } : {}) } as React.CSSProperties}>
      <div className="pane-header detached-header" style={drag}>
        <span className="pane-title">
          <span className="pane-btn pane-grip" title="Drag back onto the grid to reattach"
            style={noDrag} onPointerDown={onGripDown}>⤧</span>
          <Dot state={state} /><span className="tname">{name}</span>
        </span>
      </div>
      <div ref={elRef} style={{ flex: 1, minHeight: 0, background: oceanic.bgTerminal }} />
    </div>
  )
}
