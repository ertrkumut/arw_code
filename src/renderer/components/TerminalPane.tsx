import React, { useEffect, useState } from 'react'
import { useTerminalIO } from '../hooks/useTerminalIO'
import { oceanic } from '../theme'
import { useApp } from '../store/appStore'
import type { TermState } from '@shared/types'

function PaneBody({ termId, cwd }: { termId: string; cwd: string }) {
  const ref = useTerminalIO(termId, cwd)
  return <div ref={ref} style={{ flex: 1, minHeight: 0, background: oceanic.bgDeep }} />
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
    <div onMouseDown={onFocus} style={{
      display: 'flex', flexDirection: 'column', border: `1px solid ${focused ? oceanic.accent : oceanic.border}`,
      borderRadius: 8, overflow: 'hidden', minHeight: 0
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: oceanic.bgRaised, padding: '5px 9px', fontSize: 12, color: oceanic.textSecondary
      }}>
        <span><span style={{ color: oceanic.status[state] }}>●</span> {name}</span>
        <span style={{ color: oceanic.textMuted, cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); removeTerminal(projectId, termId) }}>✕</span>
      </div>
      {error ? (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', background: oceanic.bgDeep, padding: 16, textAlign: 'center' }}>
          <div>
            <div style={{ color: oceanic.status.error, fontSize: 13, marginBottom: 10, wordBreak: 'break-word' }}>{error}</div>
            <button onClick={(e) => { e.stopPropagation(); retry() }} style={{
              color: oceanic.accent, background: 'transparent', border: `1px solid ${oceanic.accent}`,
              borderRadius: 6, padding: '4px 12px', cursor: 'pointer'
            }}>Retry</button>
          </div>
        </div>
      ) : (
        <PaneBody key={attempt} termId={termId} cwd={cwd} />
      )}
    </div>
  )
}
