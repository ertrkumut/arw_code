import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import { listFiles, looksBinary } from './fileTree'

/** Rider's Find in Path (Ctrl+Shift+F): text search across the project. */
export interface FindOptions {
  query: string
  regex?: boolean
  matchCase?: boolean
  wholeWord?: boolean
  /** comma-separated globs on the file name, e.g. "*.cs, *.shader"; empty = all text files */
  mask?: string
  /** unsaved editor buffers: path -> text (searched instead of the disk copy) */
  overlays?: Record<string, string>
  limit?: number
}

export interface FindMatch { path: string; line: number; col: number; len: number; text: string; preview: [number, number] }
export interface FindResult { matches: FindMatch[]; files: number; truncated: boolean; error?: string }

const MAX_FILE = 4 * 1024 * 1024
const SKIP_EXT = /\.(meta|png|jpe?g|gif|bmp|tga|psd|exr|hdr|tif|tiff|ico|fbx|obj|blend|wav|mp3|ogg|mp4|mov|dll|exe|pdb|so|dylib|a|lib|zip|7z|rar|gz|unitypackage|asset|ttf|otf|bank|bytes)$/i

export function buildMatcher(o: FindOptions): RegExp {
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (o.wholeWord) src = `(?<![A-Za-z0-9_])(?:${src})(?![A-Za-z0-9_])`
  return new RegExp(src, o.matchCase ? 'g' : 'gi')
}

export function maskMatcher(mask: string | undefined): (name: string) => boolean {
  const parts = (mask ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!parts.length) return () => true
  const res = parts.map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'))
  return (name) => res.some(r => r.test(name))
}

/** Search one text; exported for tests. */
export function searchText(path: string, text: string, re: RegExp, out: FindMatch[], limit: number): number {
  let n = 0
  const lines = text.split('\n')
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const line = lines[i].replace(/\r$/, '')
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) && out.length < limit) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      // preview: trim long lines around the hit
      const start = Math.max(0, m.index - 60)
      const text = (start > 0 ? '…' : '') + line.slice(start, m.index + m[0].length + 120)
      const offset = m.index - start + (start > 0 ? 1 : 0)
      out.push({ path, line: i + 1, col: m.index + 1, len: m[0].length, text, preview: [offset, offset + m[0].length] })
      n++
    }
  }
  return n
}

export async function findInFiles(root: string, o: FindOptions): Promise<FindResult> {
  if (!o.query) return { matches: [], files: 0, truncated: false }
  let re: RegExp
  try { re = buildMatcher(o) } catch (e: any) { return { matches: [], files: 0, truncated: false, error: String(e?.message ?? e) } }
  const limit = o.limit ?? 5000
  const matchName = maskMatcher(o.mask)
  const overlays = new Map(Object.entries(o.overlays ?? {}).map(([p, t]) => [p.replace(/\\/g, '/').toLowerCase(), t]))
  const rels = await listFiles(root, 100000)
  const out: FindMatch[] = []
  let files = 0
  for (const rel of rels) {
    if (out.length >= limit) break
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    if (SKIP_EXT.test(name) || !matchName(name)) continue
    const abs = join(root, rel)
    let text = overlays.get(abs.replace(/\\/g, '/').toLowerCase())
    if (text === undefined) {
      try {
        const st = await stat(abs)
        if (st.size > MAX_FILE) continue
        const buf = await readFile(abs)
        if (looksBinary(buf)) continue
        text = buf.toString('utf8').replace(/^﻿/, '')
      } catch { continue }
    }
    if (searchText(abs, text, re, out, limit) > 0) files++
  }
  return { matches: out, files, truncated: out.length >= limit }
}
