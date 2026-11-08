import React, { useEffect, useRef, useState } from 'react'
import { CS_KEYWORDS } from '@shared/csharp'
import { useNav } from '../../store/navStore'
import { applyEdits } from '../../ide/commands'
import { getEditor, showEditorMessage } from '../../ide/context'

/** Rename refactoring (Rider: Shift+F6 / the user's Ctrl+R): new name + preview of what changes. */
export function RenameDialog({ title, name, occurrences, files }: { title: string; name: string; occurrences: { path: string; line: number; col: number; len: number }[]; files: number }) {
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.select() }, [])
  const close = () => { useNav.getState().close(); getEditor()?.focus() }
  const valid = /^@?[A-Za-z_][A-Za-z0-9_]*$/.test(value) && !CS_KEYWORDS.has(value)
  const changed = value !== name

  const apply = async () => {
    if (!valid || !changed || busy) return
    setBusy(true)
    const n = await applyEdits(occurrences.map(o => ({ ...o, text: value })))
    close()
    showEditorMessage(`Renamed ${n} occurrence${n === 1 ? '' : 's'}`)
  }

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal-card rn-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-msg">Rename <b>{name}</b> and its usages to:</div>
        <input ref={ref} autoFocus className="goto-input rn-input" value={value} spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void apply() } if (e.key === 'Escape') { e.preventDefault(); close() } }} />
        <div className="rn-info">
          {!valid ? <span className="fx-err">Not a valid C# identifier</span>
            : <>{occurrences.length} occurrence{occurrences.length === 1 ? '' : 's'} in {files} file{files === 1 ? '' : 's'} will change. Open files stay unsaved so you can review / undo.</>}
        </div>
        <div className="modal-actions">
          <button className="btn-soft" onClick={close}>Cancel</button>
          <button className="btn-modal" disabled={!valid || !changed || busy} onClick={() => void apply()}>Refactor</button>
        </div>
      </div>
    </div>
  )
}
