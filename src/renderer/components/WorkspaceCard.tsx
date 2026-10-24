import React, { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { aggregateState } from '@shared/status'
import { useApp } from '../store/appStore'
import { ContextMenu } from './ContextMenu'
import { ColorSwatchPicker } from './ColorSwatchPicker'
import { Dot } from './Dot'
import type { Project } from '@shared/types'

export function WorkspaceCard({ project }: { project: Project }) {
  const { selectedProjectId, selectProject, removeProject, setProjectColor, openHistory, statuses } = useApp()
  const selected = selectedProjectId === project.id
  const agg = aggregateState(project.terminals.map(t => statuses[t.id] ?? 'idle'))
  const showDot = project.terminals.length > 0 && agg !== 'idle'
  const [missing, setMissing] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [showColors, setShowColors] = useState(false)
  useEffect(() => { window.arw.pathExists(project.path).then(ok => setMissing(!ok)) }, [project.path])

  const closeMenu = () => { setMenu(null); setShowColors(false) }

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    ...(project.color ? { ['--pane-accent']: project.color } : {})
  } as React.CSSProperties

  return (
    <>
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}
        className={`pcard${selected ? ' active' : ''}${project.color ? ' colored' : ''}${isDragging ? ' dragging' : ''}`}
        onClick={() => selectProject(project.id)}
        onContextMenu={(e) => {
          e.preventDefault(); e.stopPropagation()
          setShowColors(false); setMenu({ x: e.clientX, y: e.clientY })
        }}>
        {showDot && <span style={{ position: 'absolute', right: 11, top: 13 }}><Dot state={agg} /></span>}
        <div className="pname">
          {project.name}
          {missing && <span style={{ color: 'var(--error)', fontSize: 10, marginLeft: 7, fontWeight: 500 }}>missing</span>}
        </div>
        <div className="ppath">{project.path}</div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}
          items={showColors ? undefined : [
            { label: 'Open folder in Explorer', onClick: () => window.arw.openInExplorer(project.path) },
            { label: 'Conversation history', onClick: () => openHistory(project.id) },
            { label: 'Change color ▸', keepOpen: true, onClick: () => setShowColors(true) },
            { label: 'Remove project', danger: true, onClick: () => { if (confirm(`Remove ${project.name}?`)) removeProject(project.id) } }
          ]}>
          {showColors && (
            <ColorSwatchPicker current={project.color}
              onPick={(c) => { setProjectColor(project.id, c); closeMenu() }} />
          )}
        </ContextMenu>
      )}
    </>
  )
}
