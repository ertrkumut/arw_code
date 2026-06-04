import React, { useEffect, useState } from 'react'
import { useTerminalIO } from '../hooks/useTerminalIO'
import { useApp } from '../store/appStore'
import { Dot } from './Dot'
import type { TermState } from '@shared/types'

function PaneBody({ termId, cwd }: { termId: string; cwd: string }) {
  const ref = useTerminalIO(termId, cwd)
  return <div ref={ref} style={{ flex: 1, minHeight: 0, background: 'var(--bg-terminal)' }} />
}

export function TerminalPane({ projectId, termId, name, cwd, focused, onFocus }:
  { projectId: string; termId: string; name: string; cwd: string; focused: boolean; onFocus: () => void }) {
  const { statuses, removeTerminal } = useApp()
  const state: TermState = statuses[termId] ?? 'idle'
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const off = window.arw.onError(({ id, message }) => { if (id === termId) setError(message) })
    return off
  }, [termId])

  const retry = () => { setError(null); setAttempt(a => a + 1) }

  return (
    <div className={`pane${focused ? ' focused' : ''}`} onMouseDown={onFocus}>
      <div className="pane-header">
        <span className="pane-title"><Dot state={state} /><span className="tname">{name}</span></span>
        <span className="pane-x" onClick={(e) => { e.stopPropagation(); removeTerminal(projectId, termId) }}>✕</span>
      </div>
      {error ? (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', padding: 16, textAlign: 'center' }}>
          <div>
            <div style={{ color: 'var(--error)', fontSize: 12.5, marginBottom: 12, wordBreak: 'break-word' }}>{error}</div>
            <button className="btn-soft" onClick={(e) => { e.stopPropagation(); retry() }}>Retry</button>
          </div>
        </div>
      ) : (
        <PaneBody key={attempt} termId={termId} cwd={cwd} />
      )}
    </div>
  )
}
