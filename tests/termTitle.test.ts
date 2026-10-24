import { describe, it, expect } from 'vitest'
import { cleanAgentTitle, DEFAULT_NAME_RE, MAX_AUTO_NAME } from '@shared/termTitle'

describe('cleanAgentTitle', () => {
  it('strips the spinner / status glyph prefix', () => {
    expect(cleanAgentTitle('✳ Fix login bug')).toBe('Fix login bug')
    expect(cleanAgentTitle('⠂ Fix login bug')).toBe('Fix login bug')
  })

  it('ignores the bare product title and empty titles', () => {
    expect(cleanAgentTitle('✳ Claude Code')).toBeNull()
    expect(cleanAgentTitle('claude')).toBeNull()
    expect(cleanAgentTitle('  ⠐ ')).toBeNull()
  })

  it('truncates long titles', () => {
    const out = cleanAgentTitle('x'.repeat(100))!
    expect(out.length).toBe(MAX_AUTO_NAME)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('DEFAULT_NAME_RE', () => {
  it('matches only the generated default name', () => {
    expect(DEFAULT_NAME_RE.test('terminal 3')).toBe(true)
    expect(DEFAULT_NAME_RE.test('my api work')).toBe(false)
  })
})
