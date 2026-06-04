import React, { useEffect, useState } from 'react'
import { useApp } from '../store/appStore'
import { oceanic } from '../theme'
import { ProjectGrid } from './ProjectGrid'

export function TerminalGrid() {
  const { projects, selectedProjectId } = useApp()
  const [activated, setActivated] = useState<string[]>([])

  // Mark a project activated the first time it's selected (lazy mount, then keep mounted).
  useEffect(() => {
    if (selectedProjectId && !activated.includes(selectedProjectId)) {
      setActivated(a => [...a, selectedProjectId])
    }
  }, [selectedProjectId, activated])

  // Render grids for projects that have been activated AND still exist; also include the
  // currently-selected project synchronously to avoid a first-render flash before the effect runs.
  const toRender = projects.filter(p => activated.includes(p.id) || p.id === selectedProjectId)

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {!selectedProjectId && (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: oceanic.textMuted }}>
          Select a project
        </div>
      )}
      {toRender.map(p => (
        <div key={p.id} style={{ height: '100%', display: p.id === selectedProjectId ? 'block' : 'none' }}>
          <ProjectGrid project={p} />
        </div>
      ))}
    </div>
  )
}
