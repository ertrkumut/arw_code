import React, { useEffect, useRef, useState } from 'react'
import { AGENT_LIST } from '@shared/agents'
import type { AgentId } from '@shared/agents'

/** The list of CLIs, used by the "New terminal" popup. */
export function AgentList({ value, onPick }: { value?: AgentId; onPick: (id: AgentId) => void }) {
  return (
    <div className="agent-list">
      {AGENT_LIST.map(a => (
        <button key={a.id} type="button"
          className={`agent-row${value === a.id ? ' selected' : ''}`}
          style={{ ['--agent-color' as string]: a.color }}
          onClick={() => onPick(a.id)}>
          <span className="agent-badge">{a.badge}</span>
          <span className="agent-row-label">{a.label}</span>
          <code className="agent-row-cmd">{a.command}</code>
        </button>
      ))}
    </div>
  )
}

/**
 * "Which CLI?" popup. Opens on every ＋ New terminal click so the choice is always
 * explicit — no hidden last-used default. Arrow keys move the highlight, Enter
 * launches, Escape closes.
 */
export function AgentPickerDialog(
  { value, onPick, onCancel }: { value?: AgentId; onPick: (id: AgentId) => void; onCancel: () => void }
) {
  const start = Math.max(0, AGENT_LIST.findIndex(a => a.id === value))
  const [idx, setIdx] = useState(start)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => { cardRef.current?.focus() }, [])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => (i + 1) % AGENT_LIST.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => (i - 1 + AGENT_LIST.length) % AGENT_LIST.length) }
    else if (e.key === 'Enter') { e.preventDefault(); onPick(AGENT_LIST[idx].id) }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div ref={cardRef} className="modal-card" role="dialog" aria-modal="true"
        tabIndex={-1} onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">New terminal</div>
        <div className="modal-msg">Pick the CLI to launch in this terminal.</div>
        <AgentList value={AGENT_LIST[idx].id} onPick={onPick} />
        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn-soft" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

/** ＋ New terminal — always opens the CLI picker popup. */
export function NewTerminalButton(
  { value, onPick, disabled }: { value?: AgentId; onPick: (id: AgentId) => void; disabled?: boolean }
) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button className="btn-pill" disabled={disabled}
        title="New terminal — choose a CLI"
        onClick={() => setOpen(true)}>
        ＋ New terminal
      </button>
      {open && (
        <AgentPickerDialog value={value}
          onPick={(id) => { setOpen(false); onPick(id) }}
          onCancel={() => setOpen(false)} />
      )}
    </>
  )
}
