import { describe, it, expect } from 'vitest'
import { applyEvent, chatFromTranscript, emptyChat } from '@shared/chatModel'
import { codexToChat, codexRolloutToTranscript, newCodexTurn } from '@shared/codexEvents'
import { codexArgs } from '@main/codexChat'
import { isChatAgent } from '@shared/agents'

const TID = '0199a213-81c0-7800-8aa1-bbab2a035a53'

/** Feed Codex events through the translator and the chat reducer, like the app does. */
function run(events: any[]) {
  const turn = newCodexTurn(0)
  let s = applyEvent(emptyChat(), { type: 'arw_user', text: 'hi', images: [] }, 0)
  for (const ev of events) for (const out of codexToChat(ev, turn, 5000)) s = applyEvent(s, out, 5000)
  return s
}

describe('codexToChat', () => {
  it('renders a full turn: thread id, reasoning, command, edit, reply, result', () => {
    const s = run([
      { type: 'thread.started', thread_id: TID },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'Look at the repo' } },
      { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: 'ls', aggregated_output: '', exit_code: null, status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'ls', aggregated_output: 'a.txt\n', exit_code: 0, status: 'completed' } },
      { type: 'item.completed', item: { id: 'item_2', type: 'file_change', changes: [{ path: 'D:/x/a.txt', kind: 'update' }, { path: 'D:/x/b.txt', kind: 'add' }], status: 'completed' } },
      { type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: 'Done.' } },
      { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } }
    ])
    expect(s.sessionId).toBe(TID)
    expect(s.busy).toBe(false)
    const kinds = s.items.map(i => i.kind)
    expect(kinds).toEqual(['user', 'thinking', 'tool', 'tool', 'tool', 'text', 'turn'])
    const tools = s.items.filter(i => i.kind === 'tool') as any[]
    expect(tools.map(t => [t.name, t.status])).toEqual([['Bash', 'done'], ['Edit', 'done'], ['Write', 'done']])
    expect(tools[0].result).toBe('a.txt\n')
    expect(tools[1].input.file_path).toBe('D:/x/a.txt')
  })

  it('marks a failing command as an error and does not duplicate its card', () => {
    const s = run([
      { type: 'item.started', item: { id: 'c', type: 'command_execution', command: 'false', status: 'in_progress' } },
      { type: 'item.updated', item: { id: 'c', type: 'command_execution', command: 'false', status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'c', type: 'command_execution', command: 'false', aggregated_output: '', exit_code: 1, status: 'failed' } }
    ])
    const tools = s.items.filter(i => i.kind === 'tool') as any[]
    expect(tools).toHaveLength(1)
    expect(tools[0].status).toBe('error')
  })

  it('shows a failed turn with its message', () => {
    const s = run([{ type: 'turn.failed', error: { message: 'usage limit reached' } }])
    const turn = s.items.at(-1) as any
    expect(turn.kind).toBe('turn')
    expect(turn.error).toBe('usage limit reached')
    expect(s.busy).toBe(false)
  })
})

describe('codexToChat — not signed in', () => {
  it('hides retry chatter and ends with one sign-in hint (sequence from a real run)', () => {
    const msg = 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses'
    const s = run([
      { type: 'error', message: 'Reconnecting... 5/5 (unexpected status 401 Unauthorized)' },
      { type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Falling back from WebSockets to HTTPS transport. unexpected status 401' } },
      { type: 'error', message: 'Reconnecting... 1/5 (unexpected status 401 Unauthorized)' },
      { type: 'error', message: msg },
      { type: 'turn.failed', error: { message: msg } }
    ])
    expect(s.items.map(i => i.kind)).toEqual(['user', 'turn'])
    expect((s.items[1] as any).error).toMatch(/isn't signed in.*codex login/)
  })
})

describe('codexRolloutToTranscript', () => {
  it('keeps only what the user typed and what Codex replied', () => {
    const rollout = [
      JSON.stringify({ type: 'session_meta', payload: { id: TID } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }] } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'fix the bug' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_reasoning', text: 'hmm' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'Fixed it.' } })
    ].join('\n')
    const s = chatFromTranscript(codexRolloutToTranscript(rollout))
    expect(s.items.map(i => [i.kind, (i as any).text])).toEqual([['user', 'fix the bug'], ['text', 'Fixed it.']])
  })
})

describe('codexArgs', () => {
  it('starts a new thread, then resumes it; prompt always on stdin', () => {
    expect(codexArgs(null, [])).toEqual(['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '-'])
    expect(codexArgs(TID, ['C:/t/a.png']).slice(-5)).toEqual(['-i', 'C:/t/a.png', 'resume', TID, '-'])
  })
})

describe('isChatAgent', () => {
  it('treats Claude and Codex panes as chats', () => {
    expect([undefined, 'claude', 'codex', 'gemini', 'kimi', 'unity'].map(a => isChatAgent(a as any))).toEqual([true, true, true, false, false, false])
  })
})

describe('codex slash command plumbing', () => {
  it('passes model and reasoning effort, and keeps unsafe names out of the shell', async () => {
    const { codexReviewArgs } = await import('@main/codexChat')
    expect(codexArgs(null, [], { model: 'gpt-5.5', effort: 'high' })).toContain('model_reasoning_effort=high')
    expect(codexArgs(null, [], { model: 'gpt-5.5' })).toEqual(expect.arrayContaining(['-m', 'gpt-5.5']))
    const bad = codexArgs(null, [], { model: 'x & calc', effort: 'ultra; rm' })
    expect(bad).not.toContain('-m')
    expect(bad.join(' ')).not.toMatch(/calc|rm/)
    expect(codexReviewArgs(undefined)).toContain('--uncommitted')
    expect(codexReviewArgs('check the auth code').at(-1)).toBe('-')
  })

  it('shows an in-chat command and its output the way Claude local commands appear', () => {
    let s = emptyChat()
    s = applyEvent(s, { type: 'user', uuid: 'a', message: { content: '<command-name>/diff</command-name>' } })
    s = applyEvent(s, { type: 'user', uuid: 'b', message: { content: '<local-command-stdout>diff --git a/x b/x</local-command-stdout>' } })
    expect(s.items.map(i => [i.kind, (i as any).text])).toEqual([['user', '/diff'], ['command', 'diff --git a/x b/x']])
    expect(s.busy).toBe(false)
  })
})

describe('codexUsageFromRollout', () => {
  const tc = (ts: string, payload: any) => JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', ...payload } })
  it('reads 5-hour and weekly limits and context from the last token_count', async () => {
    const { codexUsageFromRollout, describeCodexLimits } = await import('@shared/codexEvents')
    const jsonl = [
      tc('2026-11-12T10:00:00Z', { info: null, rate_limits: { primary: { used_percent: 5, window_minutes: 300, resets_at: 1 } } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'hi' } }),
      tc('2026-11-12T11:00:00Z', {
        info: { last_token_usage: { total_tokens: 12345 }, model_context_window: 272000 },
        rate_limits: { primary: { used_percent: 42, window_minutes: 300, resets_at: 1900000000 },
          secondary: { used_percent: 10.4, window_minutes: 10080, resets_in_seconds: 3600 } }
      })
    ].join('\n')
    const u = codexUsageFromRollout(jsonl)
    expect(u.contextTokens).toBe(12345)
    expect(u.contextWindow).toBe(272000)
    expect(u.limits?.fiveHour).toEqual({ used: 0.42, resetsAt: 1900000000 })
    expect(u.limits?.sevenDay?.used).toBeCloseTo(0.104)
    expect(u.limits?.sevenDay?.resetsAt).toBe(Date.parse('2026-11-12T11:00:00Z') / 1000 + 3600)
    expect(describeCodexLimits(u.limits, Date.parse('2026-11-12T11:00:00Z'))).toMatch(/5-hour limit: 42% used/)
    expect(codexUsageFromRollout('').limits).toBeNull()
  })
})
