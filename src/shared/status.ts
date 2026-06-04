import type { TermState } from './types'

const HOOK_MAP: Record<string, TermState> = {
  PreToolUse: 'working',
  UserPromptSubmit: 'working',
  Notification: 'needs-you',
  Stop: 'idle'
}

export function stateFromHook(hookName: string): TermState | null {
  return HOOK_MAP[hookName] ?? null
}

const PRIORITY: TermState[] = ['error', 'needs-you', 'working', 'idle']

export function aggregateState(states: TermState[]): TermState {
  for (const s of PRIORITY) if (states.includes(s)) return s
  return 'idle'
}
