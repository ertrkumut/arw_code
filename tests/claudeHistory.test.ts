import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeProjectDir, sessionTitle, listSessions, deleteSession, transcriptImages } from '@main/claudeHistory'

const A = '11111111-2222-3333-4444-555555555555'
const B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const user = (content: unknown) => JSON.stringify({ type: 'user', message: { role: 'user', content } })

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'arw-hist-')) })
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('claudeProjectDir', () => {
  it('maps every non-alphanumeric char to a dash, like Claude Code does', () => {
    expect(claudeProjectDir('D:\\PIROS\\AI\\ARWCode', home)).toBe(join(home, 'projects', 'D--PIROS-AI-ARWCode'))
    expect(claudeProjectDir('D:\\PIROS\\ - APP', home)).toBe(join(home, 'projects', 'D--PIROS----APP'))
  })
})

describe('sessionTitle', () => {
  it('prefers custom title, then the latest AI title, then the first typed prompt', () => {
    const prompt = user('fix the   login bug')
    expect(sessionTitle(prompt)).toBe('fix the login bug')
    const ai = `{"type":"ai-title","aiTitle":"Old"}\n${prompt}\n{"type":"ai-title","aiTitle":"Login fix"}`
    expect(sessionTitle(ai)).toBe('Login fix')
    expect(sessionTitle(`{"type":"custom-title","customTitle":"Mine"}\n${ai}`)).toBe('Mine')
  })
  it('skips tool results and command wrappers when finding the first prompt', () => {
    const text = [user('<command-name>/clear</command-name>'), user([{ type: 'tool_result', content: 'x' }]),
      user([{ type: 'text', text: 'real question' }])].join('\n')
    expect(sessionTitle(text)).toBe('real question')
    expect(sessionTitle('')).toBe('(untitled)')
  })
})

describe('listSessions / deleteSession', () => {
  const proj = 'C:\\work\\app'
  const dir = () => claudeProjectDir(proj, home)

  it('returns [] when the folder has no history', async () => {
    expect(await listSessions(proj, home)).toEqual([])
  })

  it('lists only uuid .jsonl files and deletes the transcript plus its sidecar folder', async () => {
    mkdirSync(dir(), { recursive: true })
    writeFileSync(join(dir(), `${A}.jsonl`), user('first'))
    writeFileSync(join(dir(), `${B}.jsonl`), user('second'))
    writeFileSync(join(dir(), 'notes.jsonl'), user('ignored'))
    mkdirSync(join(dir(), A, 'tool-results'), { recursive: true })

    const list = await listSessions(proj, home)
    expect(list.map(s => s.id).sort()).toEqual([A, B])
    expect(list.find(s => s.id === A)?.title).toBe('first')

    await deleteSession(proj, A, home)
    expect(existsSync(join(dir(), `${A}.jsonl`))).toBe(false)
    expect(existsSync(join(dir(), A))).toBe(false)
    expect((await listSessions(proj, home)).map(s => s.id)).toEqual([B])
  })

  it('refuses ids that are not uuids (no path traversal)', async () => {
    await expect(deleteSession(proj, '..\\..\\x', home)).rejects.toThrow('invalid session id')
  })
})

describe('transcriptImages', () => {
  const img = (data: string) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })
  const user = (content: unknown[]) => JSON.stringify({ type: 'user', message: { role: 'user', content } })

  it('returns images the user sent, oldest first, as data URLs', () => {
    const text = [
      user([{ type: 'text', text: '[Image #1]' }, img('AAA')]),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }),
      user([img('BBB')])
    ].join('\n')
    expect(transcriptImages(text)).toEqual(['data:image/png;base64,AAA', 'data:image/png;base64,BBB'])
  })

  it('skips images nested in tool results and malformed lines', () => {
    const text = [
      user([{ type: 'tool_result', content: [img('TOOL')] }]),
      '{"type":"user","type":"image" truncated',
      user([{ type: 'image', source: { type: 'base64', media_type: 'text/html', data: 'X' } }])
    ].join('\n')
    expect(transcriptImages(text)).toEqual([])
  })
})
