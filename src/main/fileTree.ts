import { readdir, readFile, writeFile, stat } from 'fs/promises'
import { watch, type FSWatcher } from 'fs'
import { join, dirname } from 'path'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

/** Hidden like VS Code's default `files.exclude`. */
const EXCLUDED = new Set(['.git', '.svn', '.hg', 'CVS', '.DS_Store', 'Thumbs.db'])
export const isExcluded = (name: string) => EXCLUDED.has(name)

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then files; natural, case-insensitive order (explorer.sortOrder "default"). */
export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : collator.compare(a.name, b.name))
}

/** One level of a folder — children are fetched lazily when a folder is expanded. */
export async function readDir(dir: string): Promise<DirEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true })
  return sortEntries(dirents
    .filter(d => !isExcluded(d.name))
    .map(d => ({ name: d.name, path: join(dir, d.name), isDir: d.isDirectory() })))
}

/**
 * Recursive watchers, one per project root, ref-counted. Changes are batched and
 * reported as the set of folders whose listing may have changed.
 */
export class TreeWatcher {
  private watchers = new Map<string, { w: FSWatcher; refs: number; dirs: Set<string>; timer?: NodeJS.Timeout }>()

  constructor(private onChange: (root: string, dirs: string[]) => void) {}

  watch(root: string): void {
    const cur = this.watchers.get(root)
    if (cur) { cur.refs++; return }
    let w: FSWatcher
    try {
      w = watch(root, { recursive: true })
    } catch {
      return   // missing folder or unsupported — the tree still works, just without live updates
    }
    const entry = { w, refs: 1, dirs: new Set<string>() as Set<string>, timer: undefined as NodeJS.Timeout | undefined }
    w.on('change', (_ev, file) => {
      if (!file) return
      const rel = file.toString()
      if (rel.split(/[\\/]/).some(isExcluded)) return   // .git churn
      entry.dirs.add(dirname(join(root, rel)))
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        const dirs = [...entry.dirs]
        entry.dirs.clear()
        this.onChange(root, dirs)
      }, 150)
    })
    w.on('error', () => this.close(root))
    this.watchers.set(root, entry)
  }

  unwatch(root: string): void {
    const cur = this.watchers.get(root)
    if (cur && --cur.refs <= 0) this.close(root)
  }

  private close(root: string): void {
    const cur = this.watchers.get(root)
    if (!cur) return
    clearTimeout(cur.timer)
    cur.w.close()
    this.watchers.delete(root)
  }

  dispose(): void {
    for (const root of [...this.watchers.keys()]) this.close(root)
  }
}

export const MAX_EDIT_BYTES = 8 * 1024 * 1024
/** Images are previewed, not edited, so they get a roomier cap than text (game textures run big). */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024

export type TextFile =
  | { kind: 'text'; content: string; bom: boolean }
  | { kind: 'image'; dataUrl: string; size: number }
  | { kind: 'binary' }
  | { kind: 'tooLarge'; size: number }

/** Raster/vector formats Chromium can draw in an <img>, keyed by lowercase extension. */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif'
}

export function imageMime(file: string): string | null {
  const i = file.lastIndexOf('.')
  return i < 0 ? null : (IMAGE_MIME[file.slice(i + 1).toLowerCase()] ?? null)
}

/** NUL bytes in the first 8 KB ⇒ binary (same heuristic git uses). */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

/** Read a file for the editor. A UTF-8 BOM is stripped and reported so save can restore it. */
export async function readTextFile(file: string): Promise<TextFile> {
  const st = await stat(file)
  const mime = imageMime(file)
  if (mime) {
    if (st.size > MAX_IMAGE_BYTES) return { kind: 'tooLarge', size: st.size }
    const buf = await readFile(file)
    return { kind: 'image', dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: st.size }
  }
  if (st.size > MAX_EDIT_BYTES) return { kind: 'tooLarge', size: st.size }
  const buf = await readFile(file)
  if (looksBinary(buf)) return { kind: 'binary' }
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  return { kind: 'text', content: buf.subarray(bom ? 3 : 0).toString('utf8'), bom }
}

export async function writeTextFile(file: string, content: string, bom: boolean): Promise<void> {
  const body = Buffer.from(content, 'utf8')
  await writeFile(file, bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body)
}

/** Folders skipped by Go to File: VCS, Unity's generated folders, build output, caches. */
const SKIP_DIRS = new Set(['.git', '.svn', '.hg', '.vs', '.idea', '.vscode', 'node_modules', 'Library', 'Temp', 'Logs',
  'obj', 'bin', 'UserSettings', 'Build', 'Builds', 'out', 'dist', '.gradle', 'MemoryCaptures'])

/** Every file under root (relative paths, forward slashes), for Go to File. Bounded. */
export async function listFiles(root: string, max = 50000): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, rel: string) => {
    let ents
    try { ents = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const d of ents) {
      if (out.length >= max) return
      if (isExcluded(d.name)) continue
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name)) await walk(join(dir, d.name), rel ? `${rel}/${d.name}` : d.name)
      } else if (!d.name.endsWith('.meta')) {
        out.push(rel ? `${rel}/${d.name}` : d.name)
      }
    }
  }
  await walk(root, '')
  return out
}
