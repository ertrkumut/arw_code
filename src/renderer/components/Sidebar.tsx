import React from 'react'
import { oceanic } from '../theme'
import { useApp } from '../store/appStore'
import { WorkspaceCard } from './WorkspaceCard'

export function Sidebar() {
  const { projects, addProject } = useApp()

  const onAdd = async () => {
    const path = await window.arw.pickFolder()
    if (!path) return
    const name = path.split(/[\\/]/).filter(Boolean).pop() || path
    addProject(name, path)
  }

  return (
    <div style={{ padding: 12, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ color: oceanic.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>PROJECTS</span>
        <button onClick={onAdd} style={{
          color: oceanic.accent, background: 'transparent',
          border: `1px solid ${oceanic.accent}`, borderRadius: 6, fontSize: 11, padding: '2px 8px', cursor: 'pointer'
        }}>+ Add</button>
      </div>
      {projects.map(p => <WorkspaceCard key={p.id} project={p} />)}
    </div>
  )
}
