import React from 'react'
import type { LayoutMode } from '@shared/types'

/** Inline 14px icons describing each tiling mode. */
const Icons: Record<LayoutMode, React.ReactNode> = {
  grid: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor" />
    </svg>
  ),
  vertical: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="5" rx="1" fill="currentColor" />
      <rect x="1" y="8" width="12" height="5" rx="1" fill="currentColor" />
    </svg>
  ),
  horizontal: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="12" rx="1" fill="currentColor" />
      <rect x="8" y="1" width="5" height="12" rx="1" fill="currentColor" />
    </svg>
  ),
}

const ORDER: { mode: LayoutMode; label: string }[] = [
  { mode: 'grid', label: 'Grid' },
  { mode: 'vertical', label: 'Stacked' },
  { mode: 'horizontal', label: 'Side by side' },
]

export function LayoutToggle({
  value,
  onChange,
}: {
  value: LayoutMode
  onChange: (mode: LayoutMode) => void
}) {
  return (
    <div className="layout-toggle" role="radiogroup" aria-label="Terminal layout">
      {ORDER.map(({ mode, label }) => (
        <button
          key={mode}
          className={value === mode ? 'active' : ''}
          onClick={() => onChange(mode)}
          role="radio"
          aria-checked={value === mode}
          aria-label={label}
          title={label}
        >
          {Icons[mode]}
        </button>
      ))}
    </div>
  )
}
