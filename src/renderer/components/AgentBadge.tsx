import React from 'react'
import { resolveAgent } from '@shared/agents'
import type { AgentId } from '@shared/agents'

/**
 * Two-letter tag identifying which CLI a pane is running. Always rendered (Claude
 * included) so a mixed grid reads consistently rather than making "no badge" mean
 * Claude, which is invisible until you already know the convention.
 */
export function AgentBadge({ agent }: { agent?: AgentId }) {
  const a = resolveAgent(agent)
  return (
    <span className="agent-badge" title={a.label} style={{ ['--agent-color' as string]: a.color }}>
      {a.badge}
    </span>
  )
}
