import { describe, it, expect } from 'vitest'
import { applyEvent, chatFromTranscript, emptyChat, formatDuration, limitsFromEvent, type ChatState } from '@shared/chatModel'
import { claudeArgs, userLine } from '@main/chatManager'

const run = (events: any[], start: ChatState = emptyChat()) => events.reduce((s, e) => applyEvent(s, e, 1000), start)

// Shapes copied from a real `claude -p --output-format stream-json --verbose --include-partial-messages` run.
const turn = [
  { type: 'arw_user', text: 'Edit a.txt', images: [] },
  { type: 'system', subtype: 'init', session_id: '11111111-2222-3333-4444-555555555555', model: 'claude-haiku' },
  { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me ' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'look.' } } },
  { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'Let me look.' }] } },
  { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'D:\\p\\a.txt', old_string: 'hello world', new_string: 'hello arwen' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'The file has been updated.' }] },
    tool_use_result: { filePath: 'D:\\p\\a.txt', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-hello world', '+hello arwen'] }] } },
  { type: 'assistant', message: { id: 'msg_2', content: [{ type: 'text', text: 'OK' }] } },
  { type: 'result', subtype: 'success', duration_ms: 6784, session_id: '11111111-2222-3333-4444-555555555555' }
]

describe('chat reducer', () => {
  it('builds a turn: prompt, streamed text, tool with diff, answer, footer', () => {
    const mid = run(turn.slice(0, 5))
    expect(mid.busy).toBe(true)
    expect(mid.liveText).toBe('Let me look.')
    const s = run(turn)
    expect(s.items.map(i => i.kind)).toEqual(['user', 'text', 'tool', 'text', 'turn'])
    expect(s.liveText).toBe('')
    expect(s.busy).toBe(false)
    expect(s.model).toBe('claude-haiku')
    const tool = s.items[2] as any
    expect(tool.status).toBe('done')
    expect(tool.patch[0].lines).toEqual(['-hello world', '+hello arwen'])
    expect((s.items[4] as any).ms).toBe(6784)
  })

  it('marks interrupted turns as stopped and cuts off running tools', () => {
    const s = run([
      { type: 'arw_user', text: 'go', images: [] },
      { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'sleep 99' } }] } },
      { type: 'result', subtype: 'error_during_execution', duration_ms: 1200 }
    ])
    expect((s.items.at(-1) as any).stopped).toBe(true)
    expect((s.items[1] as any).status).toBe('error')
  })

  it('nests subagent steps under their Task and keeps them out of the live text', () => {
    const s = run([
      { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'task1', name: 'Task', input: { description: 'Find usages' } }] } },
      { type: 'stream_event', parent_tool_use_id: 'task1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'sub' } } },
      { type: 'assistant', parent_tool_use_id: 'task1', message: { id: 'sub', content: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'Jump' } }] } }
    ])
    expect(s.liveText).toBe('')
    expect((s.items[1] as any).parent).toBe('task1')
  })

  it('does not duplicate blocks seen twice (transcript + live)', () => {
    const ev = { type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'same' }] } }
    expect(run([ev, ev]).items).toHaveLength(1)
  })

  it('reads a saved transcript: prompts, commands, tool results', () => {
    const lines = [
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'fix the jump bug' } },
      { type: 'user', uuid: 'u0', isMeta: true, message: { role: 'user', content: 'caveat' } },
      { type: 'user', uuid: 'u2', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
      { type: 'assistant', message: { id: 'a', content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'P.cs' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r1', content: [{ type: 'text', text: 'class P {}' }] }] } },
      { type: 'assistant', message: { id: 'b', content: [{ type: 'text', text: 'Fixed.' }] } }
    ].map(l => JSON.stringify(l)).join('\n')
    const s = chatFromTranscript(lines)
    // Commands the user ran show as "/clear" chips; meta lines stay hidden.
    expect(s.items.map(i => i.kind)).toEqual(['user', 'user', 'tool', 'text'])
    expect((s.items[1] as any).text).toBe('/clear')
    expect((s.items[2] as any).result).toBe('class P {}')
    expect(s.busy).toBe(false)
  })

  it('formats durations like Antigravity', () => {
    expect(formatDuration(6784)).toBe('7s')
    expect(formatDuration(72000)).toBe('1m 12s')
  })
})

describe('slash commands', () => {
  it('shows command output and compaction, hides the compact summary', () => {
    const s = run([
      { type: 'arw_user', text: '/compact', images: [] },
      { type: 'system', subtype: 'compact_boundary', uuid: 'cb1' },
      { type: 'user', uuid: 'sum', isCompactSummary: true, message: { content: 'This session is being continued from a previous conversation…' } },
      { type: 'user', uuid: 'o1', message: { content: '<local-command-stdout>Compacted </local-command-stdout>' } },
      { type: 'result', subtype: 'success', duration_ms: 5000 }
    ])
    expect(s.items.map(i => i.kind)).toEqual(['user', 'compacted', 'command', 'turn'])
    expect((s.items[2] as any).text).toBe('Compacted')
  })
  it('turns transcript command wrappers back into "/cmd args"', () => {
    const t = JSON.stringify({ type: 'user', uuid: 'x', message: { content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>sonnet</command-args>' } })
    const s = chatFromTranscript(t)
    expect(s.items).toHaveLength(1)
    expect((s.items[0] as any).text).toBe('/model sonnet')
  })
  it('keeps the command catalog from init', () => {
    const s = run([{ type: 'system', subtype: 'init', session_id: 's', slash_commands: ['compact', 'graphify'], terminal_slash_commands: ['doctor'] }])
    expect(s.slashCommands).toEqual(['compact', 'graphify'])
    expect(s.terminalCommands).toEqual(['doctor'])
  })
})

describe('chat manager protocol', () => {
  it('pins or resumes the session and keeps permissions skipped like the terminal did', () => {
    const fresh = claudeArgs('abc', false)
    expect(fresh).toContain('--session-id')
    expect(fresh).toContain('--dangerously-skip-permissions')
    expect(fresh.slice(0, 6)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'])
    expect(claudeArgs('abc', true)).toEqual(expect.arrayContaining(['--resume', 'abc']))
    // ARWCode pins its own model instead of inheriting the user's global default.
    expect(fresh.join(' ')).toContain('--model opus')
  })
  it('writes one JSON line per prompt', () => {
    const l = userLine([{ type: 'text', text: 'hi' }])
    expect(l.endsWith('\n')).toBe(true)
    expect(JSON.parse(l)).toEqual({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } })
  })
})

describe('terminal mode hand-off', () => {
  it('only resumes sessions Claude has actually saved', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const { sessionExists } = await import('@main/chatManager')
    const { claudeProjectDir } = await import('@main/claudeHistory')
    const home = mkdtempSync(join(tmpdir(), 'arw-home-'))
    const cwd = 'D:\Rogue Harbour\airport-billionair'
    const saved = '774240af-d047-43c0-b7f7-0c2d18f3af28', unsaved = '11111111-2222-3333-4444-555555555555'
    mkdirSync(claudeProjectDir(cwd, home), { recursive: true })
    writeFileSync(join(claudeProjectDir(cwd, home), `${saved}.jsonl`), '{}')
    expect(sessionExists(cwd, saved, home)).toBe(true)
    expect(sessionExists(cwd, unsaved, home)).toBe(false)
    expect(sessionExists(cwd, '../../etc', home)).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })
  it('the exit marker never appears in the echoed command line', async () => {
    const { exitAfterAgent, TUI_DONE_MARKER } = await import('@main/ptyManager')
    expect(exitAfterAgent('win32')).not.toContain(TUI_DONE_MARKER)
    expect(exitAfterAgent('linux')).not.toContain(TUI_DONE_MARKER)
  })
})

describe('following the terminal to another conversation', () => {
  it('picks the transcript written since terminal mode began', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const { newestSessionSince, noteSession, takeReportedSession } = await import('@main/chatManager')
    const { claudeProjectDir } = await import('@main/claudeHistory')
    const home = mkdtempSync(join(tmpdir(), 'arw-home-'))
    const cwd = 'D:\proj', dir = claudeProjectDir(cwd, home)
    mkdirSync(dir, { recursive: true })
    const old = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', resumed = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    writeFileSync(join(dir, `${old}.jsonl`), '{}'); utimesSync(join(dir, `${old}.jsonl`), 1000, 1000)
    const since = Date.now() - 50
    writeFileSync(join(dir, `${resumed}.jsonl`), '{}')
    expect(newestSessionSince(cwd, since, home)).toBe(resumed)
    expect(newestSessionSince(cwd, Date.now() + 60000, home)).toBeUndefined()
    noteSession('p:tui', resumed)
    expect(takeReportedSession('p:tui')).toBe(resumed)
    expect(takeReportedSession('p:tui')).toBeUndefined()
    rmSync(home, { recursive: true, force: true })
  })
})

describe('claude environment', () => {
  it('drops inherited Claude session markers, keeps user config', async () => {
    const { claudeEnv } = await import('@main/cleanEnv')
    const env = claudeEnv({ CLAUDE_CODE_CHILD_SESSION: '1', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787', PATH: 'p' }, { ARW_TERMINAL_ID: 't' })
    expect(env).toEqual({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787', PATH: 'p', ARW_TERMINAL_ID: 't' })
  })
})

describe('control requests', () => {
  it('frames control_request lines the way Claude expects', async () => {
    const { controlLine } = await import('@main/chatManager')
    expect(JSON.parse(controlLine('r1', 'mcp_toggle', { serverName: 'headroom', enabled: false }))).toEqual({
      type: 'control_request', request_id: 'r1', request: { subtype: 'mcp_toggle', serverName: 'headroom', enabled: false }
    })
    expect(controlLine('r2', 'interrupt').endsWith('\n')).toBe(true)
  })
  it('/model output from set_model shows as a command result', () => {
    const s = run([{ type: 'user', uuid: 'm1', isReplay: true, message: { role: 'user', content: '<local-command-stdout>Set model to `sonnet (claude-sonnet-5-5)`</local-command-stdout>' } }])
    expect(s.items.map(i => i.kind)).toEqual(['command'])
    expect((s.items[0] as any).text).toContain('Set model to')
  })
})

// Shapes copied from a real `claude -p --output-format stream-json --verbose` run (CLI 2026-11).
describe('usage', () => {
  it('reads both plan windows from rate_limit_event', () => {
    const l = limitsFromEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1793734200, rateLimitType: 'five_hour',
      unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1793734200, status: 'allowed' }, seven_day: { utilization: 0.2, resetsAt: 1794157200, status: 'allowed' } } } }, 5)
    expect(l).toEqual({ fiveHour: { used: 0.4, resetsAt: 1793734200 }, sevenDay: { used: 0.2, resetsAt: 1794157200 }, ts: 5 })
    expect(limitsFromEvent({ type: 'result' })).toBeNull()
  })

  it('tracks context from main-thread replies and cost/window from results', () => {
    const s = run([
      { type: 'system', subtype: 'init', session_id: 's', model: 'claude-opus-5-5[1m]' },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 2, cache_creation_input_tokens: 35310, cache_read_input_tokens: 100, output_tokens: 6 } } },
      // A subagent's reply must not count as this conversation's context.
      { type: 'assistant', parent_tool_use_id: 't1', message: { id: 'm2', content: [], usage: { input_tokens: 9, output_tokens: 9 } } },
      { type: 'result', subtype: 'success', duration_ms: 10, total_cost_usd: 0.0082,
        modelUsage: { 'claude-haiku-5-5': { contextWindow: 200000 }, 'claude-opus-5-5': { contextWindow: 1000000 } } }
    ])
    expect(s.contextTokens).toBe(35418)
    expect(s.costUsd).toBe(0.0082)
    expect(s.contextWindow).toBe(1000000)
  })
})
