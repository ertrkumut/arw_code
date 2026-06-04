import React from 'react'
import { oceanic } from '../theme'
import type { TermState } from '@shared/types'

export function Dot({ state, size = 8 }: { state: TermState; size?: number }) {
  const c = oceanic.status[state]
  const glow = state === 'needs-you' || state === 'error' ? `0 0 8px ${c}` : 'none'
  return <span style={{ width: size, height: size, borderRadius: '50%', background: c, boxShadow: glow, display: 'inline-block', flexShrink: 0 }} />
}
