import React, { useState } from 'react'
import { useApp } from '../store/appStore'
import { gridDims } from '@shared/tiling'
import { oceanic } from '../theme'
import { TerminalPane } from './TerminalPane'

export function TerminalGrid() {
  const { projects, selectedProjectId, addTerminal } = useApp()
  const [focused, setFocused] = useState<string | null>(null)
  const project = projects.find(p => p.id === selectedProjectId)

  if (!project) return <Empty text="Select a project" />

  const terms = [...project.terminals].sort((a, b) => a.order - b.order)
  const { rows, cols } = gridDims(terms.length)
  const effectiveFocus = focused && terms.some(t => t.id === focused) ? focused : (terms[0]?.id ?? null)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', color: oceanic.textSecondary }}>
        <span>{project.name}</span>
        <button onClick={() => addTerminal(project.id)} style={{
          color: oceanic.accent, background: 'transparent', border: `1px solid ${oceanic.accent}`,
          borderRadius: 6, padding: '2px 8px', cursor: 'pointer'
        }}>＋ new terminal</button>
      </div>
      {terms.length === 0 ? <Empty text="No terminals yet — click ＋ new terminal" /> : (
        <div style={{
          flex: 1, display: 'grid', gap: 8, padding: 8, minHeight: 0,
          gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`
        }}>
          {terms.map(t => (
            <TerminalPane key={t.id} projectId={project.id} termId={t.id} name={t.name}
              cwd={project.path} focused={effectiveFocus === t.id} onFocus={() => setFocused(t.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: oceanic.textMuted }}>{text}</div>
}
