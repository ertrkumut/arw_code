import React, { useState } from 'react'
import { useApp } from '../store/appStore'
import { gridDims } from '@shared/tiling'
import { oceanic } from '../theme'
import { TerminalPane } from './TerminalPane'
import type { Project } from '@shared/types'

export function ProjectGrid({ project }: { project: Project }) {
  const { addTerminal } = useApp()
  const [focused, setFocused] = useState<string | null>(null)
  const terms = [...project.terminals].sort((a, b) => a.order - b.order)
  const { rows, cols } = gridDims(terms.length)
  const effectiveFocus = focused && terms.some(t => t.id === focused) ? focused : (terms[0]?.id ?? null)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
        <span style={{ color: oceanic.textPrimary, fontSize: 14, fontWeight: 600 }}>{project.name}</span>
        <button className="btn-pill" onClick={() => addTerminal(project.id)}>＋ New terminal</button>
      </div>
      {terms.length === 0 ? (
        <div className="empty">No terminals yet — click ＋ New terminal</div>
      ) : (
        <div style={{
          flex: 1, display: 'grid', gap: 10, padding: '0 10px 10px', minHeight: 0,
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
