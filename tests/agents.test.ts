import { describe, it, expect } from 'vitest'
import { AGENTS, AGENT_LIST, DEFAULT_AGENT, resolveAgent, toAgentId } from '@shared/agents'
import type { AgentId } from '@shared/agents'

describe('agent registry', () => {
  it('keys the map by each agent id', () => {
    for (const [key, def] of Object.entries(AGENTS)) expect(def.id).toBe(key)
  })

  it('shows every registered agent in the picker exactly once', () => {
    expect([...AGENT_LIST].map(a => a.id).sort())
      .toEqual(Object.keys(AGENTS).sort())
    expect(new Set(AGENT_LIST.map(a => a.id)).size).toBe(AGENT_LIST.length)
  })

  it('gives every agent a distinct two-letter badge', () => {
    expect(new Set(AGENT_LIST.map(a => a.badge)).size).toBe(AGENT_LIST.length)
    for (const a of AGENT_LIST) expect(a.badge).toHaveLength(2)
  })

  it('gives every agent a distinct hex tint', () => {
    for (const a of AGENT_LIST) expect(a.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(new Set(AGENT_LIST.map(a => a.color.toLowerCase())).size).toBe(AGENT_LIST.length)
  })

  it('defaults to Claude for unknown, empty and nullish ids', () => {
    for (const v of [undefined, null, '', 'nope', 42, {}] as unknown[]) {
      expect(resolveAgent(v as string).id).toBe(DEFAULT_AGENT)
      expect(toAgentId(v)).toBe(DEFAULT_AGENT)
    }
  })

  it('round-trips every known id', () => {
    for (const a of AGENT_LIST) {
      expect(toAgentId(a.id)).toBe(a.id)
      expect(resolveAgent(a.id).command).toBe(a.command)
    }
  })
})

describe('unity row', () => {
  it('launches the Unity REPL', () => {
    expect(AGENTS.unity.command).toBe('unity shell')
    expect(AGENTS.unity.label).toBe('Unity CLI')
  })

  it('claims neither status hooks nor project MCP', () => {
    // Unity has no hooks API to report working/idle, and `unity shell` is not an
    // MCP client — the Editor bridge is wired into Claude panes by unityMcp.ts.
    expect(AGENTS.unity.hasStatusHooks).toBe(false)
    expect(AGENTS.unity.readsProjectMcp).toBe(false)
  })

  it('is listed after the AI agents', () => {
    expect(AGENT_LIST[AGENT_LIST.length - 1].id).toBe('unity')
  })
})

describe('project MCP wiring', () => {
  it('only claims project .mcp.json for Claude Code', () => {
    // Codex/Gemini/Kimi read a single user-level config, so ARWCode must not
    // write per-project MCP files on their behalf.
    const withMcp = AGENT_LIST.filter(a => a.readsProjectMcp).map(a => a.id)
    expect(withMcp).toEqual<AgentId[]>(['claude'])
  })

  it('only claims status hooks for Claude Code', () => {
    expect(AGENT_LIST.filter(a => a.hasStatusHooks).map(a => a.id)).toEqual<AgentId[]>(['claude'])
  })
})
