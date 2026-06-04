import React, { useEffect, useRef, useState } from 'react'
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
  type DragStartEvent, type DragEndEvent
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { useApp } from '../store/appStore'
import { gridDims } from '@shared/tiling'
import { oceanic } from '../theme'
import { TerminalPane } from './TerminalPane'
import type { Project } from '@shared/types'

export function ProjectGrid({ project }: { project: Project }) {
  const { addTerminal, moveTerminal, detachTerminal, maximizedTermId, setMaximized } = useApp()
  const [focused, setFocused] = useState<string | null>(null)
  const ptr = useRef<{ x: number; y: number } | null>(null)

  const terms = [...project.terminals].sort((a, b) => a.order - b.order)
  const visible = terms.filter(t => !t.detached)
  const maxId = maximizedTermId && visible.some(t => t.id === maximizedTermId) ? maximizedTermId : null
  const { rows, cols } = gridDims(visible.length)
  const effectiveFocus = focused && visible.some(t => t.id === focused) ? focused : (visible[0]?.id ?? null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // Esc restores a maximized pane.
  useEffect(() => {
    if (!maxId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMaximized(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maxId, setMaximized])

  // dnd-kit's drop event doesn't expose screen coordinates, so track the pointer
  // ourselves during a drag to decide whether the tile was released outside the app.
  const trackPointer = (e: PointerEvent) => { ptr.current = { x: e.screenX, y: e.screenY } }

  const onDragStart = (e: DragStartEvent) => {
    const ae = e.activatorEvent as PointerEvent
    if (ae && typeof ae.screenX === 'number') ptr.current = { x: ae.screenX, y: ae.screenY }
    window.addEventListener('pointermove', trackPointer)
  }

  const onDragEnd = (e: DragEndEvent) => {
    window.removeEventListener('pointermove', trackPointer)
    const { active, over } = e
    const p = ptr.current
    ptr.current = null

    const outside = !!p && (
      p.x < window.screenX || p.x > window.screenX + window.outerWidth ||
      p.y < window.screenY || p.y > window.screenY + window.outerHeight
    )
    if (outside) {
      const t = visible.find(x => x.id === active.id)
      if (t) {
        window.arw.tearOff({
          projectId: project.id, termId: t.id, name: t.name, color: t.color, cwd: project.path,
          screenX: p!.x, screenY: p!.y
        })
        detachTerminal(t.id)
      }
      return
    }
    if (over && over.id !== active.id) {
      const newIndex = terms.findIndex(t => t.id === over.id)
      if (newIndex !== -1) moveTerminal(project.id, String(active.id), newIndex)
    }
  }

  const onDragCancel = () => { window.removeEventListener('pointermove', trackPointer); ptr.current = null }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
        <span style={{ color: oceanic.textPrimary, fontSize: 14, fontWeight: 600 }}>{project.name}</span>
        <button className="btn-pill" onClick={() => addTerminal(project.id)}>＋ New terminal</button>
      </div>
      {visible.length === 0 ? (
        <div className="empty">No terminals yet — click ＋ New terminal</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter}
          onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
          <SortableContext items={visible.map(t => t.id)} strategy={rectSortingStrategy}>
            <div style={maxId ? {
              flex: 1, padding: '0 10px 10px', minHeight: 0, position: 'relative'
            } : {
              flex: 1, display: 'grid', gap: 10, padding: '0 10px 10px', minHeight: 0,
              gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`
            }}>
              {visible.map(t => {
                const paneStyle: React.CSSProperties = maxId
                  ? (t.id === maxId ? { height: '100%' } : { display: 'none' })
                  : {}
                return (
                  <TerminalPane key={t.id} projectId={project.id} termId={t.id} name={t.name} color={t.color}
                    cwd={project.path} focused={effectiveFocus === t.id} onFocus={() => setFocused(t.id)}
                    maximized={t.id === maxId} onToggleMax={() => setMaximized(maxId === t.id ? null : t.id)}
                    dndEnabled={!maxId} paneStyle={paneStyle} />
                )
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
