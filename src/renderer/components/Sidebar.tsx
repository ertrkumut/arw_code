import React from 'react'
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
    <div className="scroll-slim" style={{ padding: 14, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="label-cap">Projects</span>
        <button className="btn-soft" onClick={onAdd}>+ Add</button>
      </div>
      {projects.map(p => <WorkspaceCard key={p.id} project={p} />)}
    </div>
  )
}
