import React from 'react'
import { oceanic } from '../theme'
import { aggregateState } from '@shared/status'
import { useApp } from '../store/appStore'
import type { Project } from '@shared/types'

export function WorkspaceCard({ project }: { project: Project }) {
  const { selectedProjectId, selectProject, removeProject, statuses } = useApp()
  const selected = selectedProjectId === project.id
  const agg = aggregateState(project.terminals.map(t => statuses[t.id] ?? 'idle'))
  const showDot = project.terminals.length > 0 && agg !== 'idle'

  return (
    <div
      onClick={() => selectProject(project.id)}
      onContextMenu={(e) => { e.preventDefault(); if (confirm(`Remove ${project.name}?`)) removeProject(project.id) }}
      style={{
        position: 'relative', cursor: 'pointer', marginBottom: 8, padding: '9px 11px',
        background: selected ? oceanic.bgRaised : oceanic.bgCard,
        border: `1px solid ${selected ? oceanic.accent : oceanic.border}`, borderRadius: 8
      }}
    >
      {showDot && (
        <span style={{ position: 'absolute', right: 10, top: 10, color: oceanic.status[agg] }}>●</span>
      )}
      <div style={{ color: oceanic.textPrimary, fontSize: 13 }}>{project.name}</div>
      <div style={{ color: oceanic.textMuted, fontSize: 11, marginTop: 2 }}>{project.path}</div>
    </div>
  )
}
