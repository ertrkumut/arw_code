import React from 'react'
import { aggregateState } from '@shared/status'
import { useApp } from '../store/appStore'
import { oceanic } from '../theme'

/** Collapsed sidebar: a narrow rail of project status dots + initials. */
export function SidebarRail() {
  const { projects, selectedProjectId, selectProject, statuses, toggleSidebar } = useApp()
  return (
    <div className="rail">
      <div className="rail-list scroll-slim">
        {projects.map(p => {
          const agg = aggregateState(p.terminals.map(t => statuses[t.id] ?? 'idle'))
          const active = selectedProjectId === p.id
          const dot = p.terminals.length > 0 && agg !== 'idle' ? oceanic.status[agg] : 'transparent'
          return (
            <button key={p.id} className={`rail-item${active ? ' active' : ''}`} title={p.name}
              onClick={() => selectProject(p.id)}>
              <span className="rail-initial">{p.name.slice(0, 2).toUpperCase()}</span>
              <span className="rail-dot" style={{ background: dot }} />
            </button>
          )
        })}
      </div>
      <div className="rail-foot">
        <button className="rail-toggle wide" title="Expand sidebar" onClick={toggleSidebar}>»</button>
      </div>
    </div>
  )
}
