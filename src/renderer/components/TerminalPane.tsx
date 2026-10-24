import React, { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTerminalIO } from '../hooks/useTerminalIO'
import { useApp } from '../store/appStore'
import { ContextMenu } from './ContextMenu'
import { ColorSwatchPicker } from './ColorSwatchPicker'
import { Dot } from './Dot'
import { AgentBadge } from './AgentBadge'
import { ImageStrip } from './ImageStrip'
import type { TermState } from '@shared/types'
import type { AgentId } from '@shared/agents'

function PaneBody({ termId, cwd, agent }: { termId: string; cwd: string; agent?: AgentId }) {
  const ref = useTerminalIO(termId, cwd, agent)
  return <div ref={ref} style={{ flex: 1, minHeight: 0, padding: '4px 8px 6px', background: 'var(--bg-terminal)' }} />
}

export function TerminalPane({ projectId, termId, name, color, cwd, agent, focused, onFocus, maximized, onToggleMax, dndEnabled, paneStyle }:
  { projectId: string; termId: string; name: string; color?: string; cwd: string; agent?: AgentId
    focused: boolean; onFocus: () => void
    maximized: boolean; onToggleMax: () => void; dndEnabled: boolean; paneStyle?: React.CSSProperties }) {
  const { statuses, requestRemoveTerminal, renameTerminal, setTerminalColor } = useApp()
  const state: TermState = statuses[termId] ?? 'idle'
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [showColors, setShowColors] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } =
    useSortable({ id: termId, disabled: !dndEnabled || editing })

  useEffect(() => {
    const off = window.arw.onError(({ id, message }) => { if (id === termId) setError(message) })
    return () => { off() }
  }, [termId])

  // Focus + select the field whenever inline rename opens.
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  // Spawn is idempotent in the main process, so killing the old pty before a
  // retry guarantees a genuinely fresh shell rather than re-attaching a dead one.
  const retry = () => { window.arw.kill(termId); setError(null); setAttempt(a => a + 1) }

  const startEdit = () => { setDraft(name); setEditing(true) }
  const commitEdit = () => {
    const v = draft.trim()
    if (v && v !== name) renameTerminal(projectId, termId, v)
    setEditing(false)
  }
  const closeMenu = () => { setMenu(null); setShowColors(false) }
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setShowColors(false)
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const rootStyle = {
    ...paneStyle,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : (paneStyle?.opacity as number | undefined),
    zIndex: isDragging ? 5 : undefined,
    ...(color ? { ['--pane-accent']: color } : {})
  } as React.CSSProperties

  return (
    <div ref={setNodeRef} style={rootStyle}
      className={`pane${focused ? ' focused' : ''}${isDragging ? ' dragging' : ''}`} onMouseDown={onFocus}>
      <div className="pane-header" onContextMenu={openMenu}>
        <span ref={setActivatorNodeRef} className={`pane-title${editing ? '' : ' pane-drag'}`}
          {...(editing ? {} : attributes)} {...(editing ? {} : listeners)}>
          <Dot state={state} />
          <AgentBadge agent={agent} />
          {editing ? (
            <input ref={inputRef} className="tname-input" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit()
                else if (e.key === 'Escape') setEditing(false)
              }}
              onBlur={commitEdit}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()} />
          ) : (
            <span className="tname" title="Double-click to rename"
              onDoubleClick={(e) => { e.stopPropagation(); startEdit() }}>{name}</span>
          )}
        </span>
        <span className="pane-actions">
          <span className="pane-btn" title={maximized ? 'Restore' : 'Maximize'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleMax() }}>{maximized ? '❐' : '▢'}</span>
          <span className="pane-btn pane-x-btn" title="Close terminal"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); requestRemoveTerminal(projectId, termId) }}>✕</span>
        </span>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          {!showColors ? (
            <>
              <button className="ctx-item" onClick={() => { startEdit(); closeMenu() }}>Rename</button>
              <button className="ctx-item" onClick={() => setShowColors(true)}>Change color ▸</button>
            </>
          ) : (
            <ColorSwatchPicker current={color}
              onPick={(c) => { setTerminalColor(projectId, termId, c); closeMenu() }} />
          )}
        </ContextMenu>
      )}
      {error ? (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', padding: 16, textAlign: 'center' }}>
          <div>
            <div style={{ color: 'var(--error)', fontSize: 12.5, marginBottom: 12, wordBreak: 'break-word' }}>{error}</div>
            <button className="btn-soft" onClick={(e) => { e.stopPropagation(); retry() }}>Retry</button>
          </div>
        </div>
      ) : (
        <>
          <ImageStrip termId={termId} />
          <PaneBody key={attempt} termId={termId} cwd={cwd} agent={agent} />
        </>
      )}
    </div>
  )
}
