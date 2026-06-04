import React, { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCorners, useDroppable, type DragStartEvent, type DragEndEvent
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useApp } from '../store/appStore'
import { WorkspaceCard } from './WorkspaceCard'
import { ContextMenu, type MenuItem } from './ContextMenu'
import type { Group, Project } from '@shared/types'

type Menu = { x: number; y: number; items: MenuItem[] }

const UNGROUPED = 'ungrouped'
const keyToGroupId = (key: string): string | null => (key === UNGROUPED ? null : key.slice(6))

export function Sidebar() {
  const {
    projects, groups, addProject, addGroup, removeGroup, renameGroup, toggleGroup, moveProject, toggleSidebar
  } = useApp()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const ungrouped = useMemo(() => projects.filter(p => p.groupId == null), [projects])
  const byGroup = useMemo(() => {
    const m: Record<string, Project[]> = {}
    for (const g of groups) m[g.id] = projects.filter(p => p.groupId === g.id)
    return m
  }, [projects, groups])

  const onAdd = async () => {
    const path = await window.arw.pickFolder()
    if (!path) return
    const name = path.split(/[\\/]/).filter(Boolean).pop() || path
    addProject(name, path)
  }

  const idsInContainer = (key: string) =>
    (key === UNGROUPED ? ungrouped : byGroup[keyToGroupId(key)!] ?? []).map(p => p.id)

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    let containerKey: string
    let index: number
    if (overId === UNGROUPED || overId.startsWith('group:')) {
      containerKey = overId
      index = idsInContainer(containerKey).filter(id => id !== activeId).length // append
    } else {
      const overProj = projects.find(p => p.id === overId)
      if (!overProj) return
      containerKey = overProj.groupId == null ? UNGROUPED : `group:${overProj.groupId}`
      const ids = idsInContainer(containerKey).filter(id => id !== activeId)
      const at = ids.indexOf(overId)
      index = at === -1 ? ids.length : at
    }
    moveProject(activeId, keyToGroupId(containerKey), index)
  }

  const openSidebarMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'New group', onClick: () => setEditingGroupId(addGroup('New group')) }
    ] })
  }

  const openGroupMenu = (e: React.MouseEvent, g: Group) => {
    e.preventDefault(); e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Rename', onClick: () => setEditingGroupId(g.id) },
      { label: 'Delete group', danger: true, onClick: () => removeGroup(g.id) }
    ] })
  }

  const activeProject = activeId ? projects.find(p => p.id === activeId) : null

  return (
    <div className="sidebar-root">
      <div className="sidebar-head">
        <span className="label-cap">Projects</span>
        <button className="btn-soft" onClick={onAdd}>+ Add</button>
      </div>

      <div className="sidebar-scroll scroll-slim" onContextMenu={openSidebarMenu}>
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>

          <Section containerKey={UNGROUPED} ids={idsInContainer(UNGROUPED)}
            showLabel={groups.length > 0 && ungrouped.length > 0}>
            {ungrouped.map(p => <WorkspaceCard key={p.id} project={p} />)}
          </Section>

          {groups.map(g => (
            <GroupSection key={g.id} group={g} projects={byGroup[g.id] ?? []}
              editing={editingGroupId === g.id}
              onRenameCommit={(name) => { renameGroup(g.id, name.trim() || g.name); setEditingGroupId(null) }}
              onToggle={() => toggleGroup(g.id)}
              onMenu={(e) => openGroupMenu(e, g)} />
          ))}

          <DragOverlay>
            {activeProject
              ? <div className="pcard dragging-overlay"><div className="pname">{activeProject.name}</div></div>
              : null}
          </DragOverlay>
        </DndContext>
      </div>

      <div className="sidebar-foot">
        <button className="rail-toggle wide" title="Collapse sidebar" onClick={toggleSidebar}>« Collapse</button>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

/** A droppable section wrapping a SortableContext for its cards. */
function Section({ containerKey, ids, showLabel, children }:
  { containerKey: string; ids: string[]; showLabel?: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: containerKey })
  return (
    <div ref={setNodeRef} className={`section${isOver ? ' drop-over' : ''}`}>
      {showLabel && <div className="section-label">Ungrouped</div>}
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  )
}

function GroupSection({ group, projects, editing, onRenameCommit, onToggle, onMenu }:
  { group: Group; projects: Project[]; editing: boolean
    onRenameCommit: (name: string) => void; onToggle: () => void; onMenu: (e: React.MouseEvent) => void }) {
  const key = `group:${group.id}`
  const { setNodeRef, isOver } = useDroppable({ id: key })
  const ids = projects.map(p => p.id)
  return (
    <div ref={setNodeRef} className={`group${isOver ? ' drop-over' : ''}`}>
      <div className="group-head" onClick={onToggle} onContextMenu={onMenu}>
        <span className={`chev${group.collapsed ? '' : ' open'}`}>▸</span>
        {editing
          ? <input className="group-rename" autoFocus defaultValue={group.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => onRenameCommit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameCommit((e.target as HTMLInputElement).value)
                if (e.key === 'Escape') onRenameCommit(group.name)
              }} />
          : <span className="group-name">{group.name}</span>}
        <span className="group-count">{projects.length}</span>
      </div>
      {!group.collapsed && (
        <div className="group-body">
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {projects.map(p => <WorkspaceCard key={p.id} project={p} />)}
          </SortableContext>
          {projects.length === 0 && <div className="group-empty">Drop projects here</div>}
        </div>
      )}
    </div>
  )
}
