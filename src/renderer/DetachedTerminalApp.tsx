import React, { useEffect, useState } from 'react'
import { useTerminalIO } from './hooks/useTerminalIO'
import { Dot } from './components/Dot'
import { AgentBadge } from './components/AgentBadge'
import { ImageStrip } from './components/ImageStrip'
import { ImageLightbox } from './components/ImageLightbox'
import { AssetsPanel } from './components/AssetsPanel'
import { ChatView } from './components/chat/ChatView'
import { oceanic } from './theme'
import type { TermState } from '@shared/types'
import type { AgentId } from '@shared/agents'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * The single-terminal view shown in a torn-off window. The shell already runs
 * in the main process (spawn is idempotent), so mounting here just attaches a
 * fresh xterm to the live pty. Dragging the grip back over the main window
 * reattaches; closing the OS window kills the shell (handled in the main process).
 */
function DetachedXterm({ termId, cwd, agent }: { termId: string; cwd: string; agent?: AgentId }) {
  const elRef = useTerminalIO(termId, cwd, agent)
  return (
    <>
      {(agent ?? 'claude') === 'claude'
        ? <ChatView termId={termId} cwd={cwd} project={null} />
        : <DetachedXterm termId={termId} cwd={cwd} agent={agent} />}
    </>
  )
}

export function DetachedTerminalApp({ termId, name, color, cwd, agent }:
  { termId: string; name: string; color?: string; cwd: string; agent?: AgentId }) {
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
          <Dot state={state} /><AgentBadge agent={agent} /><span className="tname">{name}</span>
        </span>
      </div>
      {(agent ?? 'claude') === 'claude'
        ? <ChatView termId={termId} cwd={cwd} project={null} />
        : <DetachedXterm termId={termId} cwd={cwd} agent={agent} />}
      <AssetsPanel />
      <ImageLightbox />
    </div>
  )
}
