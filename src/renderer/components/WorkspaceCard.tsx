import React, { useEffect, useState } from 'react'
import { aggregateState } from '@shared/status'
import { useApp } from '../store/appStore'
import { Dot } from './Dot'
import type { Project } from '@shared/types'

export function WorkspaceCard({ project }: { project: Project }) {
  const { selectedProjectId, selectProject, removeProject, statuses } = useApp()
  const selected = selectedProjectId === project.id
  const agg = aggregateState(project.terminals.map(t => statuses[t.id] ?? 'idle'))
  const showDot = project.terminals.length > 0 && agg !== 'idle'
  const [missing, setMissing] = useState(false)
  useEffect(() => { window.arw.pathExists(project.path).then(ok => setMissing(!ok)) }, [project.path])

  return (
    <div className={`pcard${selected ? ' active' : ''}`}
      onClick={() => selectProject(project.id)}
      onContextMenu={(e) => { e.preventDefault(); if (confirm(`Remove ${project.name}?`)) removeProject(project.id) }}>
      {showDot && <span style={{ position: 'absolute', right: 11, top: 13 }}><Dot state={agg} /></span>}
      <div className="pname">
        {project.name}
        {missing && <span style={{ color: 'var(--error)', fontSize: 10, marginLeft: 7, fontWeight: 500 }}>missing</span>}
      </div>
      <div className="ppath">{project.path}</div>
    </div>
  )
}
