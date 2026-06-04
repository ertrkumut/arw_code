import React, { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

export function ContextMenu({ x, y, items, children, onClose }:
  { x: number; y: number; items?: MenuItem[]; children?: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onEsc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onEsc) }
  }, [onClose])

  // Keep the menu inside the viewport. Custom-children menus use a coarse height estimate.
  const rows = items?.length ?? 4
  const left = Math.min(x, window.innerWidth - 180)
  const top = Math.min(y, window.innerHeight - (rows * 32 + 8))

  return (
    <div ref={ref} className="ctx-menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      {items?.map((it, i) => (
        <button key={i} className={`ctx-item${it.danger ? ' danger' : ''}`}
          onClick={() => { it.onClick(); onClose() }}>
          {it.label}
        </button>
      ))}
      {children}
    </div>
  )
}
