import React, { useEffect, useRef, useState } from 'react'

/** Themed confirmation modal. Arrow keys / Tab move between the two buttons,
 *  Enter activates the focused one, Escape cancels (backdrop click cancels too).
 *  Used to guard destructive actions (e.g. closing a terminal while Claude is working). */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, onConfirm, onCancel, extraLabel, onExtra }:
  { title: string; message: React.ReactNode; confirmLabel?: string; cancelLabel?: string
    danger?: boolean; onConfirm: () => void; onCancel: () => void
    /** Optional third button shown first (e.g. "Don't save"). */
    extraLabel?: string; onExtra?: () => void }) {
  const buttons = [
    ...(extraLabel && onExtra ? [{ label: extraLabel, run: onExtra, cls: 'btn-soft' }] : []),
    { label: cancelLabel, run: onCancel, cls: 'btn-soft' },
    { label: confirmLabel, run: onConfirm, cls: `btn-modal${danger ? ' danger' : ''}` }
  ]
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  // Confirm (last) is the default.
  const [idx, setIdx] = useState(buttons.length - 1)

  // Keep real DOM focus on the active button (accessibility + native activation).
  useEffect(() => { refs.current[idx]?.focus() }, [idx])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault(); onCancel(); break
        case 'ArrowLeft': case 'ArrowUp':
          e.preventDefault(); setIdx(i => (i + buttons.length - 1) % buttons.length); break
        case 'ArrowRight': case 'ArrowDown': case 'Tab':
          e.preventDefault(); setIdx(i => (i + 1) % buttons.length); break
        case 'Enter':
          e.preventDefault(); buttons[idx]?.run(); break
      }
      e.stopPropagation()
    }
    // Capture so the global Ctrl+W/Ctrl+N handler, the editor and xterm don't see these
    // keys while the dialog is open.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-card" role="alertdialog" aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-msg">{message}</div>
        <div className="modal-actions">
          {buttons.map((b, i) => (
            <button key={b.label} ref={el => { refs.current[i] = el }} className={`${b.cls}${idx === i ? ' is-focused' : ''}`}
              onMouseEnter={() => setIdx(i)} onClick={b.run}>{b.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
