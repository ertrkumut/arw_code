import React, { useEffect, useRef, useState } from 'react'

/** Themed confirmation modal. Arrow keys / Tab move between the two buttons,
 *  Enter activates the focused one, Escape cancels (backdrop click cancels too).
 *  Used to guard destructive actions (e.g. closing a terminal while Claude is working). */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, onConfirm, onCancel }:
  { title: string; message: React.ReactNode; confirmLabel?: string; cancelLabel?: string
    danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Which button is active: 0 = cancel, 1 = confirm. Confirm is the default.
  const [idx, setIdx] = useState(1)

  // Keep real DOM focus on the active button (accessibility + native activation).
  useEffect(() => { (idx === 0 ? cancelRef : confirmRef).current?.focus() }, [idx])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault(); onCancel(); break
        case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': case 'Tab':
          // Only two buttons — any of these just toggles between them.
          e.preventDefault(); setIdx(i => (i === 0 ? 1 : 0)); break
        case 'Enter':
          e.preventDefault(); (idx === 0 ? onCancel : onConfirm)(); break
      }
    }
    // Capture so the global Ctrl+W/Ctrl+N handler and xterm don't see these keys
    // while the dialog is open.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [idx, onConfirm, onCancel])

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-card" role="alertdialog" aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-msg">{message}</div>
        <div className="modal-actions">
          <button ref={cancelRef} className={`btn-soft${idx === 0 ? ' is-focused' : ''}`}
            onMouseEnter={() => setIdx(0)} onClick={onCancel}>{cancelLabel}</button>
          <button ref={confirmRef} className={`btn-modal${danger ? ' danger' : ''}${idx === 1 ? ' is-focused' : ''}`}
            onMouseEnter={() => setIdx(1)} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
