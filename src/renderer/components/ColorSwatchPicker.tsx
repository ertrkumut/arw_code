import React from 'react'
import { COLOR_PRESETS } from '../theme'

/**
 * Swatch grid used inside context menus to pick a preset color (or clear it).
 * Shared by terminals, projects, and groups. `onPick(null)` resets to default.
 */
export function ColorSwatchPicker({ current, onPick }:
  { current?: string; onPick: (color: string | null) => void }) {
  return (
    <div className="ctx-colors">
      {COLOR_PRESETS.map(p => (
        <button key={p.value} className={`ctx-swatch${current === p.value ? ' active' : ''}`}
          title={p.name} style={{ background: p.value }}
          onClick={() => onPick(p.value)} />
      ))}
      <button className="ctx-swatch ctx-swatch-default" title="Default (no color)"
        onClick={() => onPick(null)}>✕</button>
    </div>
  )
}
