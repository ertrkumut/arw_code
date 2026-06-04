import React from 'react'
import { oceanic } from '../theme'

export function TitleBar() {
  return (
    <div className="titlebar" style={{
      height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
      padding: '0 14px', background: oceanic.bgSidebar, borderBottom: `1px solid ${oceanic.border}`,
      userSelect: 'none'
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 6,
        background: `linear-gradient(135deg, ${oceanic.accent}, ${oceanic.accentDim})`,
        display: 'grid', placeItems: 'center', fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, fontWeight: 700, color: '#0D0F15', boxShadow: `0 0 10px ${oceanic.accentGlow}`
      }}>{'>_'}</div>
      <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.02em', color: oceanic.textPrimary }}>ARWCode</span>
    </div>
  )
}
