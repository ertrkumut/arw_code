/**
 * Finds file / folder paths in chat text so they can be clicked to open their folder.
 *
 * Recognised:
 *   D:\PIROS\x\a.cs   D:/x/y   C:\Users\me\       — Windows absolute
 *   ~/x/y   ~\x                                    — home
 *   /c/Users/me/x   /usr/bin                       — POSIX / Git Bash absolute (2+ segments)
 *   src/main/ipc.ts   ./a/b.json   .claude/x.md    — relative with a file extension
 *   src/renderer/                                  — relative folder (2+ segments, trailing slash)
 * A trailing ":12" / ":12:3" line suffix is kept in the link but not in the path.
 *
 * Deliberately conservative: a bare "foo.ts" or "and/or" is not a path, and URL pieces
 * (https://host/a/b) never match.
 */

export interface PathMatch { start: number; end: number; /** as written, minus any :line suffix */ path: string }

const SEG = String.raw`[\w.@$%+=~-]`
const PATTERNS: RegExp[] = [
  // Windows absolute: no spaces (a spaced path needs quotes/backticks — see wholeCodePath)
  new RegExp(String.raw`(?<![\w/\\])[A-Za-z]:[\\/](?:[^\s"'\`<>|*?,;()\[\]{}]+)?`, 'g'),
  // home
  new RegExp(String.raw`(?<![\w/\\])~[\\/][^\s"'\`<>|*?,;()\[\]{}]*`, 'g'),
  // POSIX absolute with at least two segments
  new RegExp(String.raw`(?<![\w:/.\\@-])\/(?:${SEG}+\/)+${SEG}*`, 'g'),
  // relative file with an extension
  new RegExp(String.raw`(?<![\w:/.\\@-])(?:\.{1,2}[\\/])?(?:${SEG}+[\\/])+${SEG}*\.[A-Za-z0-9]{1,8}(?![\w/\\])`, 'g'),
  // relative folder: 2+ segments ending in a slash
  new RegExp(String.raw`(?<![\w:/.\\@-])(?:\.{1,2}[\\/])?(?:${SEG}+[\\/]){2,}(?![\w])`, 'g')
]

const LINE_SUFFIX = /(:\d+){1,2}$/
const TRAILING = /[.,;:!?)\]}'"`]+$/

/** All paths in `text`, non-overlapping, in order. */
export function findPaths(text: string): PathMatch[] {
  const hits: PathMatch[] = []
  for (const re of PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      // Drop sentence punctuation after the path ("see src/a.ts." / "(in D:\x)").
      const kept = m[0].replace(TRAILING, '')
      const start = m.index
      let end = start + kept.length
      // Keep a line suffix written right after it ("src/a.ts:12").
      if (kept === m[0]) end += /^(:\d+){1,2}/.exec(text.slice(end))?.[0].length ?? 0
      const path = kept.replace(LINE_SUFFIX, '')
      if (path.length < 3 || !/[\\/]/.test(path.slice(1))) continue
      if (/^[A-Za-z]:[\\/]$/.test(path)) continue                       // a bare drive, "C:\"
      if (hits.some(h => start < h.end && end > h.start)) continue
      hits.push({ start, end, path })
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}

/**
 * Inline code that is entirely one absolute path, spaces allowed
 * (`C:\Program Files\App\x.exe`). Relative paths with spaces are too ambiguous.
 */
export function wholeCodePath(text: string): string | null {
  const t = text.trim()
  if (!/^([A-Za-z]:[\\/]|~[\\/])/.test(t) || /[<>"|*?\n]/.test(t) || t.length < 4) return null
  return t.replace(LINE_SUFFIX, '')
}

/** Split text into plain / path pieces (for rendering). */
export function splitPaths(text: string): ({ text: string } | { text: string; path: string })[] {
  const out: ({ text: string } | { text: string; path: string })[] = []
  let at = 0
  for (const h of findPaths(text)) {
    if (h.start > at) out.push({ text: text.slice(at, h.start) })
    out.push({ text: text.slice(h.start, h.end), path: h.path })
    at = h.end
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}
