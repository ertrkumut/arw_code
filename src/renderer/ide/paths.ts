/** Comparable key for a file path: forward slashes, no trailing slash, case-folded on
 *  Windows (NTFS is case-insensitive; the debugger may report a different casing). */
export function fileKey(p: string, platform: string = typeof navigator !== 'undefined' ? navigator.platform : ''): string {
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^win/i.test(platform) || /^[a-zA-Z]:\//.test(n) ? n.toLowerCase() : n
}

export const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p

export const extOf = (p: string) => {
  const b = baseName(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toLowerCase() : ''
}

/** Path relative to a root, with forward slashes; the input unchanged when outside it. */
export function relativeTo(root: string, p: string): string {
  const r = p.replace(/\\/g, '/'), base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return fileKey(r).startsWith(fileKey(base) + '/') ? r.slice(base.length + 1) : r
}

/** The member-access expression ending at `col` (1-based, exclusive) on a line, e.g.
 *  hovering `position` in `transform.position.x` → "transform.position". Used for
 *  debugger hover evaluation. Returns null when there's no identifier there. */
export function expressionAt(line: string, startCol: number, endCol: number): string | null {
  const word = line.slice(startCol - 1, endCol - 1)
  if (!/^[A-Za-z_@]\w*$/.test(word)) return null
  let i = startCol - 1
  // walk left over `ident.` / `this.` chains
  for (;;) {
    const m = /([A-Za-z_@]\w*)\s*\.\s*$/.exec(line.slice(0, i))
    if (!m) break
    i = m.index
  }
  return line.slice(i, endCol - 1).replace(/\s+/g, '')
}
