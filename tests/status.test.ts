import { describe, it, expect } from 'vitest'
import { stateFromHook, aggregateState } from '@shared/status'

describe('stateFromHook', () => {
  it('maps PreToolUse to working', () => expect(stateFromHook('PreToolUse')).toBe('working'))
  it('maps UserPromptSubmit to working', () => expect(stateFromHook('UserPromptSubmit')).toBe('working'))
  it('maps Notification to needs-you', () => expect(stateFromHook('Notification')).toBe('needs-you'))
  it('maps Stop to idle', () => expect(stateFromHook('Stop')).toBe('idle'))
  it('returns null for unknown hook', () => expect(stateFromHook('Nope')).toBeNull())
})

describe('aggregateState', () => {
  it('error wins over everything', () =>
    expect(aggregateState(['idle', 'working', 'needs-you', 'error'])).toBe('error'))
  it('needs-you wins over working/idle', () =>
    expect(aggregateState(['idle', 'working', 'needs-you'])).toBe('needs-you'))
  it('working wins over idle', () => expect(aggregateState(['idle', 'working'])).toBe('working'))
  it('all idle -> idle', () => expect(aggregateState(['idle', 'idle'])).toBe('idle'))
  it('empty -> idle', () => expect(aggregateState([])).toBe('idle'))
})
