/**
 * Lightweight C# structure parser — no compiler, no language server.
 *
 * Good enough to power Rider-style navigation in a Unity project: it finds namespaces,
 * types (with base lists), members (methods, constructors, properties, fields, events,
 * enum members) with their signatures, XML doc comments, and source ranges. Method bodies
 * are skipped as opaque blocks; locals are resolved separately (see `findLocalDeclaration`).
 *
 * Everything works on a *masked* copy of the source where comments, string/char contents
 * and preprocessor lines are blanked to spaces (same length, newlines kept), so offsets in
 * the masked text are offsets in the real file.
 */

export type CsKind =
  | 'namespace' | 'class' | 'struct' | 'interface' | 'enum' | 'record' | 'delegate'
  | 'method' | 'constructor' | 'property' | 'indexer' | 'field' | 'const' | 'event' | 'enumMember'

export const TYPE_KINDS: ReadonlySet<CsKind> = new Set<CsKind>(['class', 'struct', 'interface', 'enum', 'record', 'delegate'])
export const isTypeKind = (k: CsKind) => TYPE_KINDS.has(k)

export interface CsParam { type: string; name: string; modifier?: string; def?: string }

export interface CsSymbol {
  name: string
  kind: CsKind
  /** 1-based position of the symbol's name */
  line: number
  col: number
  /** last line of the declaration (closing brace for bodies) */
  endLine: number
  /** offsets of the whole declaration, attributes excluded, body included */
  start: number
  end: number
  /** offset of the body (`{` or `=>`) for methods/ctors/properties */
  bodyStart?: number
  /** enclosing type path, e.g. "Outer.Inner" (null for top-level types) */
  container: string | null
  namespace: string
  modifiers: string[]
  /** field/property/event type, method or delegate return type */
  type?: string
  params?: CsParam[]
  typeParams?: string[]
  /** types: base class / interfaces as simple names (generic args and qualifiers dropped) */
  bases?: string[]
  /** one-line declaration, attributes and body removed */
  signature: string
  /** XML doc comment (without the leading ///) */
  doc?: string
  attributes?: string[]
}

export interface CsFile { usings: string[]; symbols: CsSymbol[] }

export const CS_KEYWORDS = new Set([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked', 'class', 'const',
  'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern',
  'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface',
  'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override',
  'params', 'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short',
  'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'virtual', 'void', 'volatile', 'while',
  'async', 'await', 'var', 'nameof', 'when', 'where', 'yield', 'get', 'set', 'init', 'value', 'record', 'with'
])

/** Built-in type keywords (valid as a declared type). */
export const CS_BUILTIN_TYPES = new Set([
  'bool', 'byte', 'sbyte', 'char', 'decimal', 'double', 'float', 'int', 'uint', 'long', 'ulong', 'short', 'ushort',
  'object', 'string', 'void', 'dynamic', 'nint', 'nuint'
])

// ---------------------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------------------

/** Comments, string/char contents and preprocessor lines → spaces. Same length; newlines kept. */
export function maskCode(src: string): string {
  const n = src.length
  const out = new Uint16Array(n)
  for (let i = 0; i < n; i++) out[i] = src.charCodeAt(i)
  const blank = (a: number, b: number) => {
    for (let k = a; k < b && k < n; k++) { const c = out[k]; if (c !== 10 && c !== 13) out[k] = 32 }
  }
  const ch = (i: number) => (i < n ? src[i] : '')

  /** Scan code from i. In an interpolation hole, stop at the matching `}` and return its index. */
  const code = (start: number, inHole: boolean): number => {
    let i = start, depth = 0, lineStart = !inHole && (start === 0 || src[start - 1] === '\n')
    while (i < n) {
      const c = src[i]
      if (c === '\n') { lineStart = true; i++; continue }
      if (lineStart && c === '#' && !inHole) {
        let e = src.indexOf('\n', i); if (e < 0) e = n
        blank(i, e); i = e; continue
      }
      if (c !== ' ' && c !== '\t' && c !== '\r') lineStart = false
      if (c === '/' && ch(i + 1) === '/') {
        let e = src.indexOf('\n', i); if (e < 0) e = n
        blank(i, e); i = e; continue
      }
      if (c === '/' && ch(i + 1) === '*') {
        let e = src.indexOf('*/', i + 2); e = e < 0 ? n : e + 2
        blank(i, e); i = e; continue
      }
      if (c === '"' || ((c === '$' || c === '@') && (ch(i + 1) === '"' || ((ch(i + 1) === '$' || ch(i + 1) === '@') && ch(i + 2) === '"')))) {
        i = str(i); continue
      }
      if (c === '\'') { i = chr(i); continue }
      if (inHole) {
        if (c === '{') depth++
        else if (c === '}') { if (depth === 0) return i; depth-- }
      }
      i++
    }
    return n
  }

  const chr = (i: number): number => {
    // 'x' '\n' '\'' 'ሴ' — stays on one line
    let k = i + 1
    while (k < n && src[k] !== '\'' && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1
    if (k < n && src[k] === '\'') { blank(i + 1, k); return k + 1 }
    return i + 1   // stray apostrophe
  }

  const str = (i: number): number => {
    let interp = false, verbatim = false, k = i
    while (src[k] === '$' || src[k] === '@') { if (src[k] === '$') interp = true; else verbatim = true; k++ }
    // raw string literal """..."""
    if (src.startsWith('"""', k)) {
      let q = 0; while (src[k + q] === '"') q++
      const close = src.indexOf('"'.repeat(q), k + q)
      const e = close < 0 ? n : close
      blank(k + q, e)
      return close < 0 ? n : close + q
    }
    k++ // opening quote
    let segStart = k
    while (k < n) {
      const c = src[k]
      if (verbatim) {
        if (c === '"') { if (src[k + 1] === '"') { k += 2; continue } break }
      } else {
        if (c === '\\') { k += 2; continue }
        if (c === '"' || c === '\n') break
      }
      if (interp && c === '{') {
        if (src[k + 1] === '{') { k += 2; continue }
        blank(segStart, k)
        const close = code(k + 1, true)
        k = close + 1
        segStart = k
        continue
      }
      k++
    }
    blank(segStart, Math.min(k, n))
    return k < n && src[k] === '"' ? k + 1 : k
  }

  code(0, false)
  let s = ''
  for (let i = 0; i < n; i += 8192) s += String.fromCharCode.apply(null, out.subarray(i, i + 8192) as unknown as number[])
  return s
}

// ---------------------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------------------

export function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

/** 0-based offset → 1-based {line, col}. */
export function posAt(starts: number[], off: number): { line: number; col: number } {
  let lo = 0, hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= off) lo = mid; else hi = mid - 1
  }
  return { line: lo + 1, col: off - starts[lo] + 1 }
}

const isIdent = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c)

/** Ranges of top-level `sep` in s[a,b), ignoring separators inside () [] {} <>. */
function splitTop(s: string, a: number, b: number, sep: string, angles = true): [number, number][] {
  const out: [number, number][] = []
  let depth = 0, start = a
  for (let i = a; i < b; i++) {
    const c = s[i]
    if (c === '(' || c === '[' || c === '{' || (angles && c === '<')) depth++
    else if (c === ')' || c === ']' || c === '}' || (angles && c === '>' && s[i - 1] !== '=')) depth = Math.max(0, depth - 1)
    else if (c === sep && depth === 0) { out.push([start, i]); start = i + 1 }
  }
  out.push([start, b])
  return out
}

/** Index of the first top-level `=` (or `=>`), ignoring ones inside () []. -1 if none. */
function topLevelAssign(s: string): number {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    else if (c === '=' && depth === 0) {
      const p = s[i - 1], nx = s[i + 1]
      if (nx === '=' || p === '=' || p === '!' || p === '<' || p === '>') continue
      return i
    }
  }
  return -1
}

/** "List<Foo>[]?" → "List"; "UnityEngine.MonoBehaviour" → "MonoBehaviour". */
export function simpleTypeName(t: string): string {
  let s = t.trim().replace(/^(?:ref|out|in|params|readonly|this)\s+/, '')
  // drop generic args (balanced), arrays, nullable, pointer
  let r = '', d = 0
  for (const c of s) {
    if (c === '<') d++
    else if (c === '>') d = Math.max(0, d - 1)
    else if (d === 0) r += c
  }
  s = r.replace(/\[[\s,]*\]/g, '').replace(/[?*]/g, '').trim()
  if (s.startsWith('(')) return s   // tuple
  const parts = s.split('.')
  return parts[parts.length - 1].replace(/^global::/, '').replace(/^@/, '').trim()
}

/** The first generic argument: "List<Enemy>" → "Enemy". */
export function genericArg(t: string): string | null {
  const m = /<\s*([^<>,]+)/.exec(t)
  return m ? simpleTypeName(m[1]) : null
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

const MODIFIERS = new Set(['public', 'private', 'protected', 'internal', 'static', 'virtual', 'override', 'abstract',
  'sealed', 'async', 'extern', 'unsafe', 'new', 'partial', 'readonly', 'volatile', 'const', 'fixed', 'required',
  'file', 'implicit', 'explicit', 'ref'])
const MODS = `(?:(?:${[...MODIFIERS].join('|')})\\s+)*`

const RE_TYPE = new RegExp(`^(${MODS})(class|struct|interface|enum|record(?:\\s+class|\\s+struct)?)\\s+(@?[A-Za-z_]\\w*)\\s*(<[^{]*?>)?\\s*(\\([\\s\\S]*?\\))?\\s*(?::\\s*([\\s\\S]*?))?\\s*(?:\\bwhere\\b[\\s\\S]*)?$`, 'd')
const RE_DELEGATE = new RegExp(`^(${MODS})delegate\\s+([\\s\\S]+?)\\s+(@?[A-Za-z_]\\w*)\\s*(<[^()]*>)?\\s*\\(([\\s\\S]*)\\)\\s*(?:\\bwhere\\b[\\s\\S]*)?$`, 'd')
const RE_METHOD = new RegExp(`^(${MODS})(?:([\\s\\S]+?)\\s+)?(~?@?[A-Za-z_]\\w*(?:\\s*\\.\\s*@?[A-Za-z_]\\w*)*)\\s*(<[^()]*>)?\\s*\\(([\\s\\S]*)\\)\\s*(?::\\s*(?:base|this)\\s*\\([\\s\\S]*\\))?\\s*(?:\\bwhere\\b[\\s\\S]*)?$`, 'd')
const RE_PROP = new RegExp(`^(${MODS})(?:(event)\\s+)?([\\s\\S]+?)\\s+(@?[A-Za-z_]\\w*(?:\\s*\\.\\s*@?[A-Za-z_]\\w*)*)$`, 'd')
const RE_INDEXER = new RegExp(`^(${MODS})([\\s\\S]+?)\\s+((?:[A-Za-z_][\\w.]*\\.)?this)\\s*\\[([\\s\\S]*)\\]$`, 'd')
const RE_NAME_ONLY = /^(@?[A-Za-z_]\w*)/d

function modsOf(s: string): string[] {
  return s.trim() ? s.trim().split(/\s+/) : []
}

/** Looks like a type expression (not `return x` / `new Foo`). */
function plausibleType(t: string): boolean {
  const s = t.trim()
  if (!s) return false
  const first = /^[A-Za-z_@][\w]*/.exec(s)?.[0]
  if (first && CS_KEYWORDS.has(first) && !CS_BUILTIN_TYPES.has(first) && first !== 'var') return false
  return /^[\w@.:<>,\s[\]?()*]+$/.test(s)
}

// ---------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------

type Scope =
  | { kind: 'ns'; ns: string }
  | { kind: 'type'; name: string; sym: CsSymbol }
  | { kind: 'enum'; name: string; sym: CsSymbol }
  | { kind: 'member'; sym: CsSymbol | null }
  | { kind: 'block' }
  | { kind: 'init' }

export function parseCSharp(src: string, masked: string = maskCode(src)): CsFile {
  const m = masked
  const starts = lineStartsOf(src)
  const lines = src.split('\n')
  const usings: string[] = []
  const symbols: CsSymbol[] = []
  const stack: Scope[] = [{ kind: 'ns', ns: '' }]
  let hdrStart = 0

  const curNs = () => {
    for (let k = stack.length - 1; k >= 0; k--) { const s = stack[k]; if (s.kind === 'ns') return s.ns }
    return ''
  }
  const container = (): string | null => {
    const names = stack.filter(s => s.kind === 'type' || s.kind === 'enum').map(s => (s as { name: string }).name)
    return names.length ? names.join('.') : null
  }
  const containerSimple = () => {
    for (let k = stack.length - 1; k >= 0; k--) { const s = stack[k]; if (s.kind === 'type' || s.kind === 'enum') return s.name }
    return null
  }

  const docAbove = (off: number): string | undefined => {
    let ln = posAt(starts, off).line - 2   // 0-based index of the line above
    const out: string[] = []
    while (ln >= 0) {
      const t = lines[ln].trim()
      if (t.startsWith('///')) { out.unshift(t.slice(3).replace(/^ /, '')); ln-- }
      else if (t.startsWith('[') && t.endsWith(']')) ln--   // attribute line between doc and decl
      else break
    }
    return out.length ? out.join('\n') : undefined
  }

  /** Strip leading whitespace + attributes. Returns the offset where the declaration proper starts. */
  const skipAttributes = (a: number, b: number): { at: number; attrs: string[]; declStart: number } => {
    let i = a
    const attrs: string[] = []
    while (i < b && /\s/.test(m[i])) i++
    const declStart = i
    while (i < b && m[i] === '[') {
      let d = 0, k = i
      for (; k < b; k++) { if (m[k] === '[') d++; else if (m[k] === ']') { d--; if (d === 0) break } }
      attrs.push(collapse(src.slice(i + 1, k)))
      i = k + 1
      while (i < b && /\s/.test(m[i])) i++
    }
    return { at: i, attrs, declStart }
  }

  const parseParams = (a: number, b: number): CsParam[] => {
    if (!m.slice(a, b).trim()) return []
    return splitTop(m, a, b, ',').map(([s, e]) => {
      let ps = s
      while (ps < e && /\s/.test(m[ps])) ps++
      while (ps < e && m[ps] === '[') {   // parameter attributes
        let d = 0
        for (; ps < e; ps++) { if (m[ps] === '[') d++; else if (m[ps] === ']') { d--; if (d === 0) { ps++; break } } }
        while (ps < e && /\s/.test(m[ps])) ps++
      }
      const raw = src.slice(ps, e)
      const eq = topLevelAssign(m.slice(ps, e))
      const decl = collapse(eq >= 0 ? raw.slice(0, eq) : raw)
      const def = eq >= 0 ? collapse(raw.slice(eq + 1)) : undefined
      const pm = /^((?:(?:this|ref|out|in|params|scoped|readonly)\s+)*)([\s\S]+?)\s+(@?[A-Za-z_]\w*)$/.exec(decl)
      if (!pm) return { type: decl, name: '' }
      const mod = pm[1].trim() || undefined
      return { type: pm[2].trim(), name: pm[3], modifier: mod, def }
    })
  }

  const typeParamsOf = (s: string | undefined) => (s ? s.replace(/^<|>$/g, '').split(',').map(x => x.trim().replace(/^(?:in|out)\s+/, '')).filter(Boolean) : undefined)

  const make = (o: Partial<CsSymbol> & { name: string; kind: CsKind; nameOff: number; start: number; end: number; sigEnd: number; attrs: string[] }): CsSymbol => {
    const p = posAt(starts, o.nameOff)
    const sym: CsSymbol = {
      name: o.name.replace(/^@/, ''), kind: o.kind, line: p.line, col: p.col,
      endLine: posAt(starts, Math.max(o.start, o.end - 1)).line,
      start: o.start, end: o.end, bodyStart: o.bodyStart,
      container: container(), namespace: curNs(),
      modifiers: o.modifiers ?? [], type: o.type, params: o.params, typeParams: o.typeParams, bases: o.bases,
      signature: collapse(stripComments(src.slice(o.start, o.sigEnd))),
      doc: docAbove(o.start),
      attributes: o.attrs.length ? o.attrs : undefined
    }
    symbols.push(sym)
    return sym
  }

  /** A header ended at `{` (open) or `;` (stmt). Returns the scope to push for `{`. */
  const classify = (a: number, b: number, at: '{' | ';'): Scope | null => {
    const top = stack[stack.length - 1]
    const { at: s0, attrs, declStart } = skipAttributes(a, b)
    let e = b
    while (e > s0 && /\s/.test(m[e - 1])) e--
    if (e <= s0) return at === '{' ? { kind: 'block' } : null
    const rest = m.slice(s0, e)
    const off = (k: number) => s0 + k

    if (top.kind === 'ns') {
      const ns = /^namespace\s+([\w.@]+)$/.exec(rest)
      if (ns) {
        const full = top.ns ? `${top.ns}.${ns[1]}` : ns[1]
        if (at === ';') { (top as { ns: string }).ns = full; return null }
        return { kind: 'ns', ns: full }
      }
      const u = /^(?:global\s+)?using\s+(?:static\s+)?(?:(\w+)\s*=\s*)?([\w.]+)/.exec(rest)
      if (u && at === ';') { if (!u[1]) usings.push(u[2]); return null }
    }

    if (top.kind === 'ns' || top.kind === 'type') {
      const t = RE_TYPE.exec(rest)
      if (t && t.indices) {
        const kw = t[2].startsWith('record') ? 'record' : t[2] as CsKind
        const basesRaw = t[6]
        const bases = basesRaw
          ? splitTop(basesRaw, 0, basesRaw.length, ',').map(([x, y]) => simpleTypeName(basesRaw.slice(x, y).replace(/\([\s\S]*\)/, ''))).filter(Boolean)
          : undefined
        const params = t[5] && t.indices[5] ? parseParams(off(t.indices[5][0] + 1), off(t.indices[5][1] - 1)) : undefined
        const sym = make({
          name: t[3], kind: kw, nameOff: off(t.indices[3][0]), start: declStart, end: at === ';' ? b + 1 : b, sigEnd: e, attrs,
          modifiers: modsOf(t[1]), bases, typeParams: typeParamsOf(t[4]), params
        })
        if (at === ';') return null
        return kw === 'enum' ? { kind: 'enum', name: sym.name, sym } : { kind: 'type', name: sym.name, sym }
      }
      const d = RE_DELEGATE.exec(rest)
      if (d && d.indices && at === ';') {
        make({
          name: d[3], kind: 'delegate', nameOff: off(d.indices[3][0]), start: declStart, end: b + 1, sigEnd: e, attrs,
          modifiers: modsOf(d[1]), type: collapse(d[2]), typeParams: typeParamsOf(d[4]),
          params: parseParams(off(d.indices[5][0]), off(d.indices[5][1]))
        })
        return null
      }
    }

    if (top.kind !== 'type') return at === '{' ? { kind: 'block' } : null

    // ---- members ----
    if (/\boperator\b/.test(rest)) return at === '{' ? { kind: 'member', sym: null } : null
    // Signature part: before a top-level `=>` / `=` (expression body / initializer).
    const assign = topLevelAssign(rest)
    const arrow = assign >= 0 && rest[assign + 1] === '>'
    const sig = assign >= 0 ? rest.slice(0, assign) : rest
    let sigLen = sig.length
    while (sigLen > 0 && /\s/.test(sig[sigLen - 1])) sigLen--
    const sigT = sig.slice(0, sigLen)
    const bodyAt = at === '{' && assign < 0 ? b : assign >= 0 ? off(assign) : undefined

    // `=> expr { … }` / `= new X { … }` — the brace belongs to an expression; keep reading to `;`.
    if (at === '{' && assign >= 0) return { kind: 'init' }

    const mm = RE_METHOD.exec(sigT)
    if (mm && mm.indices && (mm[2] === undefined || plausibleType(mm[2]))) {
      const name = mm[3].replace(/\s+/g, '').split('.').pop()!
      const plain = name.replace(/^~/, '')
      const owner = containerSimple()
      const isCtor = !mm[2] && plain === owner
      if (mm[2] || isCtor) {
        const sym = make({
          name, kind: isCtor ? 'constructor' : 'method',
          nameOff: off(mm.indices[3][1] - plain.length), start: declStart, end: at === ';' ? b + 1 : b, sigEnd: off(sigLen), attrs,
          modifiers: modsOf(mm[1]), type: mm[2] ? collapse(mm[2]) : undefined, typeParams: typeParamsOf(mm[4]),
          params: parseParams(off(mm.indices[5][0]), off(mm.indices[5][1])), bodyStart: bodyAt
        })
        return at === '{' ? { kind: 'member', sym } : null
      }
    }

    const ix = RE_INDEXER.exec(sigT)
    if (ix && ix.indices) {
      const sym = make({
        name: 'this', kind: 'indexer', nameOff: off(ix.indices[3][0]), start: declStart, end: at === ';' ? b + 1 : b, sigEnd: off(sigLen), attrs,
        modifiers: modsOf(ix[1]), type: collapse(ix[2]), params: parseParams(off(ix.indices[4][0]), off(ix.indices[4][1])), bodyStart: bodyAt
      })
      return at === '{' ? { kind: 'member', sym } : null
    }

    if (at === '{' || arrow) {
      // property / event with accessors, or expression-bodied property
      const p = RE_PROP.exec(sigT)
      if (p && p.indices && plausibleType(p[3])) {
        const name = p[4].replace(/\s+/g, '').split('.').pop()!
        const sym = make({
          name, kind: p[2] ? 'event' : 'property', nameOff: off(p.indices[4][1] - name.length), start: declStart,
          end: at === ';' ? b + 1 : b, sigEnd: off(sigLen), attrs, modifiers: modsOf(p[1]), type: collapse(p[3]), bodyStart: bodyAt
        })
        return at === '{' ? { kind: 'member', sym } : null
      }
      return at === '{' ? { kind: 'member', sym: null } : null
    }

    // ---- field / const / event declarations: `int a, b = 2;` ----
    const parts = splitTop(m, s0, e, ',')
    const first = parts[0]
    const firstText = m.slice(first[0], first[1])
    const fa = topLevelAssign(firstText)
    const firstDecl = (fa >= 0 ? firstText.slice(0, fa) : firstText).replace(/\s+$/, '')
    const f = RE_PROP.exec(firstDecl)
    if (!f || !f.indices || !plausibleType(f[3])) return null
    const mods = modsOf(f[1])
    const kind: CsKind = f[2] ? 'event' : mods.includes('const') ? 'const' : 'field'
    const type = collapse(f[3])
    const firstEnd = first[0] + firstDecl.length
    make({ name: f[4], kind, nameOff: first[0] + f.indices[4][0], start: declStart, end: b + 1, sigEnd: firstEnd, attrs, modifiers: mods, type })
    for (const [x, y] of parts.slice(1)) {
      let k = x
      while (k < y && /\s/.test(m[k])) k++
      const nm = RE_NAME_ONLY.exec(m.slice(k, y))
      if (!nm) continue
      const sym = make({ name: nm[1], kind, nameOff: k, start: declStart, end: b + 1, sigEnd: firstEnd, attrs, modifiers: mods, type })
      sym.signature = `${collapse(stripComments(src.slice(declStart, first[0] + f.indices[3][1])))} ${sym.name}`
    }
    return null
  }

  const enumMember = (a: number, b: number) => {
    const { at: s0, attrs, declStart } = skipAttributes(a, b)
    const nm = RE_NAME_ONLY.exec(m.slice(s0, b))
    if (!nm || !m.slice(s0, b).trim()) return
    let e = b
    while (e > s0 && /\s/.test(m[e - 1])) e--
    const owner = stack[stack.length - 1] as { kind: 'enum'; sym: CsSymbol }
    make({ name: nm[1], kind: 'enumMember', nameOff: s0, start: declStart, end: e, sigEnd: e, attrs, type: owner.sym.name })
  }

  const close = (sc: Scope, at: number) => {
    const sym = sc.kind === 'type' || sc.kind === 'enum' ? sc.sym : sc.kind === 'member' ? sc.sym : null
    if (sym) { sym.end = at + 1; sym.endLine = posAt(starts, at).line }
  }

  for (let i = 0; i < m.length; i++) {
    const c = m[i]
    if (c !== '{' && c !== '}' && c !== ';' && c !== ',') continue
    const top = stack[stack.length - 1]
    if (top.kind === 'block' || top.kind === 'member' || top.kind === 'init') {
      if (c === '{') stack.push({ kind: 'block' })
      else if (c === '}') {
        const popped = stack.pop()!
        close(popped, i)
        if (stack.length === 0) stack.push({ kind: 'ns', ns: '' })
        const nt = stack[stack.length - 1]
        if (popped.kind !== 'init' && (nt.kind === 'ns' || nt.kind === 'type' || nt.kind === 'enum')) hdrStart = i + 1
      }
      continue
    }
    if (c === ',') {
      if (top.kind === 'enum') {
        // only split on commas outside parens (attribute args)
        const seg = m.slice(hdrStart, i)
        let d = 0
        for (const x of seg) { if (x === '(' || x === '[') d++; else if (x === ')' || x === ']') d-- }
        if (d === 0) { enumMember(hdrStart, i); hdrStart = i + 1 }
      }
      continue
    }
    if (c === '{') {
      const sc = top.kind === 'enum' ? { kind: 'block' as const } : classify(hdrStart, i, '{') ?? { kind: 'block' as const }
      stack.push(sc)
      if (sc.kind !== 'init') hdrStart = i + 1
    } else if (c === '}') {
      if (top.kind === 'enum') enumMember(hdrStart, i)
      if (stack.length > 1) close(stack.pop()!, i)
      hdrStart = i + 1
    } else if (c === ';') {
      if (top.kind !== 'enum') classify(hdrStart, i, ';')
      hdrStart = i + 1
    }
  }
  return { usings, symbols }
}

// ---------------------------------------------------------------------------------------
// Queries over one file
// ---------------------------------------------------------------------------------------

/** All whole-word occurrences of `word` in masked text (offsets). */
export function wordOccurrences(masked: string, word: string): number[] {
  const out: number[] = []
  if (!word) return out
  let i = masked.indexOf(word)
  while (i >= 0) {
    if (!isIdent(masked[i - 1]) && !isIdent(masked[i + word.length])) out.push(i)
    i = masked.indexOf(word, i + word.length)
  }
  return out
}

/** Identifier → count, for usage counting. */
export function countWords(masked: string): Map<string, number> {
  const out = new Map<string, number>()
  const re = /[A-Za-z_][A-Za-z0-9_]*/g
  let mt: RegExpExecArray | null
  while ((mt = re.exec(masked))) {
    const w = mt[0]
    if (w.length < 2 || CS_KEYWORDS.has(w)) continue
    out.set(w, (out.get(w) ?? 0) + 1)
  }
  return out
}

/** Innermost symbol whose range contains the offset (optionally only these kinds). */
export function symbolAt(file: CsFile, off: number, kinds?: (k: CsKind) => boolean): CsSymbol | null {
  let best: CsSymbol | null = null
  for (const s of file.symbols) {
    if (off < s.start || off > s.end) continue
    if (kinds && !kinds(s.kind)) continue
    if (!best || s.end - s.start <= best.end - best.start) best = s
  }
  return best
}

export interface LocalDecl { name: string; type: string | null; offset: number; isParam: boolean; init?: string }

/**
 * Declaration of a local variable / parameter named `word` visible at `off`, searching the
 * enclosing member. Approximate: nearest declaration before the use wins.
 */
export function findLocalDeclaration(src: string, masked: string, file: CsFile, off: number, word: string): LocalDecl | null {
  const member = symbolAt(file, off, k => k === 'method' || k === 'constructor' || k === 'property' || k === 'indexer' || k === 'event')
  if (!member) return null
  // parameters
  for (const p of member.params ?? []) {
    if (p.name !== word) continue
    const sigText = masked.slice(member.start, member.bodyStart ?? member.end)
    const occ = wordOccurrences(sigText, word)
    const o = occ.length ? member.start + occ[occ.length - 1] : member.start
    return { name: word, type: p.type, offset: o, isParam: true }
  }
  if (member.kind === 'property' && word === 'value') return { name: 'value', type: member.type ?? null, offset: member.start, isParam: true }
  const from = member.bodyStart ?? member.start
  if (off < from) return null
  const body = masked.slice(from, Math.max(from, off + word.length))
  let found: LocalDecl | null = null
  for (const rel of wordOccurrences(body, word)) {
    const at = from + rel
    const before = masked.slice(Math.max(from, at - 200), at)
    const after = masked.slice(at + word.length, at + word.length + 40)
    // lambda parameter: `x =>` or `(a, x) =>`
    if (/^\s*=>/.test(after) || (/^\s*[,)]/.test(after) && /\(\s*(?:[A-Za-z_]\w*\s*,\s*)*$/.test(before) && /^[^;{}]*?\)\s*=>/.test(after))) {
      found = { name: word, type: null, offset: at, isParam: true }; continue
    }
    if (!/^\s*(?:[=;,)]|\bin\b|:)/.test(after) || /^\s*==/.test(after)) continue
    const tm = /(?:^|[\s(,;{}])((?:(?:ref|out|in|scoped|const|using|await)\s+)*)(var|[A-Za-z_][\w.]*(?:\s*<[\w\s,.<>?[\]]*>)?(?:\s*\[[\s,]*\])*\??|\([\w\s.<>?[\]]+,[\w\s,.<>?[\]]+\))\s+$/.exec(before)
    if (!tm) continue
    const t = tm[2].trim()
    const firstWord = /^[A-Za-z_]\w*/.exec(t)?.[0]
    if (firstWord && CS_KEYWORDS.has(firstWord) && !CS_BUILTIN_TYPES.has(firstWord) && firstWord !== 'var') continue
    let init: string | undefined
    if (/^\s*=[^=]/.test(after)) {
      const semi = masked.indexOf(';', at)
      init = src.slice(at + word.length, semi < 0 ? at + 200 : Math.min(semi, at + 300)).replace(/^\s*=/, '').trim()
    }
    found = { name: word, type: t === 'var' ? null : t, offset: at, isParam: false, init }
  }
  return found
}

/** Best guess at the type an initializer expression produces (`new Foo()`, `GetComponent<Foo>()`, casts…). */
export function inferInitType(init: string | undefined): string | null {
  if (!init) return null
  const s = init.trim()
  let mt = /^new\s+([A-Za-z_][\w.]*(?:<[^()]*>)?)\s*[({[]/.exec(s)
  if (mt) return mt[1]
  mt = /(?:GetComponent|GetComponentInChildren|GetComponentInParent|AddComponent|FindObjectOfType|FindFirstObjectByType|FindAnyObjectByType|Instantiate|Load|LoadAsset|GetRequiredService|GetService)\s*<\s*([\w.]+)\s*>/.exec(s)
  if (mt) return mt[1]
  mt = /^\(\s*([A-Za-z_][\w.]*)\s*\)/.exec(s)
  if (mt) return mt[1]
  mt = /\bas\s+([A-Za-z_][\w.]*)\s*$/.exec(s)
  if (mt) return mt[1]
  if (/^".*"$|^\$"|^@"/.test(s)) return 'string'
  if (/^-?\d+(\.\d+)?f$/i.test(s)) return 'float'
  if (/^-?\d+$/.test(s)) return 'int'
  if (/^(true|false)$/.test(s)) return 'bool'
  return null
}

/**
 * The qualifier chain before the identifier at `startOff` in masked text:
 * `transform.position.x` with the caret on `x` → ["transform", "position"].
 * Calls / indexers collapse: `GetComponent<Foo>().bar` → ["GetComponent<Foo>()"].
 */
export function qualifierChain(masked: string, startOff: number): string[] {
  const out: string[] = []
  let i = startOff
  for (;;) {
    let k = i - 1
    while (k >= 0 && /\s/.test(masked[k])) k--
    if (masked[k] !== '.' || masked[k - 1] === '.') break
    if (masked[k - 1] === '?') k--   // ?.
    k--
    while (k >= 0 && /\s/.test(masked[k])) k--
    let end = k + 1
    // skip a call / indexer suffix
    let suffix = ''
    while (masked[k] === ')' || masked[k] === ']') {
      const open = masked[k] === ')' ? '(' : '['
      const closeCh = masked[k]
      let d = 0
      for (; k >= 0; k--) { if (masked[k] === closeCh) d++; else if (masked[k] === open) { d--; if (d === 0) break } }
      suffix = (open === '(' ? '()' : '[]') + suffix
      k--
      while (k >= 0 && /\s/.test(masked[k])) k--
    }
    // generic args
    let generic = ''
    if (masked[k] === '>') {
      let d = 0, g = k
      for (; g >= 0; g--) { if (masked[g] === '>') d++; else if (masked[g] === '<') { d--; if (d === 0) break } }
      generic = masked.slice(g, k + 1)
      k = g - 1
    }
    end = k + 1
    while (k >= 0 && isIdent(masked[k])) k--
    const id = masked.slice(k + 1, end)
    if (!id || /^\d/.test(id)) break
    out.unshift(id + generic.replace(/\s+/g, '') + suffix)
    i = k + 1
  }
  return out
}

// ---------------------------------------------------------------------------------------
// XML docs → markdown
// ---------------------------------------------------------------------------------------

export function docToMarkdown(doc: string | undefined): string {
  if (!doc) return ''
  const inline = (s: string) => s
    .replace(/<see\s+cref="(?:[A-Z]:)?([^"]+)"\s*\/>/g, (_m, c) => '`' + c.split('.').pop() + '`')
    .replace(/<see\s+langword="([^"]+)"\s*\/>/g, '`$1`')
    .replace(/<paramref\s+name="([^"]+)"\s*\/>/g, '`$1`')
    .replace(/<typeparamref\s+name="([^"]+)"\s*\/>/g, '`$1`')
    .replace(/<c>([\s\S]*?)<\/c>/g, '`$1`')
    .replace(/<code>([\s\S]*?)<\/code>/g, '\n```\n$1\n```\n')
    .replace(/<para>|<\/para>/g, '\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim()
  const out: string[] = []
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(doc)
  if (summary) out.push(inline(summary[1]).replace(/\s*\n\s*/g, ' '))
  else if (!/<\w+/.test(doc)) out.push(doc.trim())
  const params = [...doc.matchAll(/<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g)]
  if (params.length) out.push('**Parameters**\n\n' + params.map(p => `- \`${p[1]}\` — ${inline(p[2]).replace(/\s*\n\s*/g, ' ')}`).join('\n'))
  const ret = /<returns>([\s\S]*?)<\/returns>/.exec(doc)
  if (ret) out.push(`**Returns** ${inline(ret[1]).replace(/\s*\n\s*/g, ' ')}`)
  const remarks = /<remarks>([\s\S]*?)<\/remarks>/.exec(doc)
  if (remarks) out.push(inline(remarks[1]))
  return out.join('\n\n')
}

/** First sentence of a doc summary (for completion details, code vision tooltips). */
export function docSummary(doc: string | undefined): string {
  const md = docToMarkdown(doc).split('\n\n')[0] ?? ''
  return md.length > 160 ? md.slice(0, 157) + '…' : md
}

// ---------------------------------------------------------------------------------------
// Fuzzy matching (Go to Symbol / Search Everywhere)
// ---------------------------------------------------------------------------------------

/** CamelHumps-aware fuzzy score; -1 = no match. "PlCo" matches "PlayerController". */
export function fuzzyName(query: string, name: string): number {
  if (!query) return 0
  const q = query.toLowerCase(), t = name.toLowerCase()
  if (t === q) return 1000
  if (t.startsWith(q)) return 800 - name.length
  // CamelHumps: query chars match word-starts first
  let ti = 0, score = 0, streak = 0
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    let idx = -1
    // prefer an upper-case hump / after underscore at or after ti
    for (let k = ti; k < name.length; k++) {
      if (t[k] !== c) continue
      const hump = k === 0 || name[k] !== t[k] || name[k - 1] === '_' || name[k - 1] === '.'
      if (k === ti || hump) { idx = k; break }
      if (idx < 0) idx = k
    }
    if (idx < 0) return -1
    const hump = idx === 0 || name[idx] !== t[idx] || name[idx - 1] === '_'
    streak = idx === ti ? streak + 1 : 0
    score += 1 + streak * 2 + (hump ? 6 : 0)
    ti = idx + 1
  }
  return score + (t.includes(q) ? 40 : 0) - name.length * 0.05
}
