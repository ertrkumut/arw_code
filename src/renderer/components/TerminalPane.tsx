import React from 'react'
import { useTerminalIO } from '../hooks/useTerminalIO'
import { oceanic } from '../theme'
import { useApp } from '../store/appStore'
import type { TermState } from '@shared/types'

export function TerminalPane({ projectId, termId, name, cwd, focused, onFocus }:
  { projectId: string; termId: string; name: string; cwd: string; focused: boolean; onFocus: () => void }) {
  const ref = useTerminalIO(termId, cwd)
  const { statuses, removeTerminal } = useApp()
  const state: TermState = statuses[termId] ?? 'idle'

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
      <div ref={ref} style={{ flex: 1, minHeight: 0, background: oceanic.bgDeep }} />
    </div>
  )
}
