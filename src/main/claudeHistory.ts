import { readdir, readFile, stat, rm } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

/** One saved Claude Code conversation for a project folder. */
export interface ClaudeSession {
  id: string          // session uuid — what `claude --resume <id>` takes
  title: string       // custom title > AI title > first prompt
  updatedAt: number   // file mtime (ms)
  sizeBytes: number
}

/** Session ids are uuids. Anything else is refused before it reaches a path or a shell. */
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

/** Claude stores a folder's history under projects/<path with every non-alphanumeric char → '-'>. */
export function claudeProjectDir(projectPath: string, home = claudeHome()): string {
  return join(home, 'projects', projectPath.replace(/[^a-zA-Z0-9]/g, '-'))
}

/** Pull a readable title out of a session transcript (JSONL, one event per line). */
export function sessionTitle(text: string): string {
  let custom = '', ai = '', firstPrompt = ''
  for (const line of text.split('\n')) {
    // Cheap prefix checks first — transcript lines can be huge and most aren't titles.
    if (line.startsWith('{"type":"custom-title"') || line.startsWith('{"type":"ai-title"')) {
      try {
        const e = JSON.parse(line)
        if (e.type === 'custom-title' && e.customTitle) custom = e.customTitle
        if (e.type === 'ai-title' && e.aiTitle) ai = e.aiTitle
      } catch { /* partial line */ }
    } else if (!firstPrompt && line.includes('"type":"user"')) {
      try {
        const e = JSON.parse(line)
        const c = e.type === 'user' && !e.isMeta ? e.message?.content : undefined
        const s = typeof c === 'string' ? c
          : Array.isArray(c) ? (c.find((b: { type?: string }) => b?.type === 'text')?.text ?? '') : ''
        // Skip command/hook wrappers like <command-name>…, keep what the human typed.
        if (s.trim() && !s.trimStart().startsWith('<')) firstPrompt = s.trim().replace(/\s+/g, ' ')
      } catch { /* partial line */ }
    }
  }
  return custom || ai || firstPrompt.slice(0, 120) || '(untitled)'
}

/** All Claude sessions recorded for this folder, newest first. Missing dir → []. */
export async function listSessions(projectPath: string, home = claudeHome()): Promise<ClaudeSession[]> {
  const dir = claudeProjectDir(projectPath, home)
  let names: string[]
  try { names = await readdir(dir) } catch { return [] }
  const out: ClaudeSession[] = []
  for (const name of names) {
    const id = name.replace(/\.jsonl$/, '')
    if (id === name || !SESSION_ID_RE.test(id)) continue
    try {
      const file = join(dir, name)
      const st = await stat(file)
      const title = sessionTitle(await readFile(file, 'utf8'))
      out.push({ id, title, updatedAt: st.mtimeMs, sizeBytes: st.size })
    } catch { /* unreadable / vanished mid-scan */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Cap on images pulled from one transcript — each is megabytes of base64. */
const MAX_SESSION_IMAGES = 40

/** Images the user sent in a transcript, as data URLs, oldest first (latest MAX_SESSION_IMAGES). */
export function transcriptImages(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    // Only top-level user content: images inside tool results (screenshots Claude read) are skipped.
    if (!line.includes('"type":"image"') || !line.includes('"type":"user"')) continue
    try {
      const e = JSON.parse(line)
      const c = e.type === 'user' ? e.message?.content : undefined
      if (!Array.isArray(c)) continue
      for (const b of c) {
        const s = b?.type === 'image' ? b.source : undefined
        if (s?.type === 'base64' && typeof s.data === 'string' && /^image\/[a-z+.-]+$/.test(s.media_type))
          out.push(`data:${s.media_type};base64,${s.data}`)
      }
    } catch { /* partial line */ }
  }
  return out.slice(-MAX_SESSION_IMAGES)
}

/** Images sent in one session of this folder. Missing transcript → []. */
export async function sessionImages(projectPath: string, id: string, home = claudeHome()): Promise<string[]> {
  if (!SESSION_ID_RE.test(id)) return []
  try { return transcriptImages(await readFile(join(claudeProjectDir(projectPath, home), `${id}.jsonl`), 'utf8')) }
  catch { return [] }
}

/** Delete a session's transcript plus its sidecar folder (subagent logs, tool outputs). */
export async function deleteSession(projectPath: string, id: string, home = claudeHome()): Promise<void> {
  if (!SESSION_ID_RE.test(id)) throw new Error('invalid session id')
  const dir = claudeProjectDir(projectPath, home)
  await rm(join(dir, `${id}.jsonl`), { force: true })
  await rm(join(dir, id), { recursive: true, force: true })
}
