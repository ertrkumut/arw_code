/**
 * Code insight on top of the C# parser + a project-wide symbol source: what does the
 * identifier under the caret refer to, what can be completed here, which overload is being
 * called, parameter-name hints, Code Vision data. Heuristic (no compiler), but it follows
 * types through locals, fields, properties, method returns and base classes, which covers
 * the bulk of real navigation in a Unity project.
 */
import {
  maskCode, parseCSharp, findLocalDeclaration, inferInitType, qualifierChain, simpleTypeName, symbolAt, isTypeKind,
  lineStartsOf, posAt, wordOccurrences, CS_KEYWORDS, CS_BUILTIN_TYPES, type CsFile, type CsSymbol, type CsKind
} from './csharp'
import { UNITY_BEHAVIOUR_BASES, UNITY_MESSAGE_MAP, UNITY_MESSAGES } from './unityApi'

export interface SymRef extends CsSymbol { path: string }

export interface SymbolSource {
  /** every symbol with this exact name */
  byName(name: string): SymRef[]
  /** members declared directly in a type (simple name; nested containers match on the last segment) */
  byContainer(typeName: string): SymRef[]
  allTypes(): SymRef[]
  /** whole-word occurrences of `name` across the project (code only) */
  wordCount(name: string): number
}

export interface Doc { path: string; src: string; masked: string; file: CsFile; starts: number[] }

export function makeDoc(path: string, src: string): Doc {
  const masked = maskCode(src)
  return { path, src, masked, file: parseCSharp(src, masked), starts: lineStartsOf(src) }
}

export interface Loc { path: string; line: number; col: number; len: number }

export type Resolution =
  | { kind: 'none' }
  | { kind: 'local'; word: string; decl: Loc; onDecl: boolean; type: string | null; isParam: boolean; range: [number, number] }
  | { kind: 'symbols'; word: string; targets: SymRef[]; onDecl: boolean; exact: boolean; range: [number, number] }
  | { kind: 'external'; word: string; typeName?: string; range: [number, number] }

const isId = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c)
const lastSeg = (s: string) => s.slice(s.lastIndexOf('.') + 1)

export function wordRangeAt(masked: string, off: number): [number, number] | null {
  let s = off
  if (!isId(masked[s]) && isId(masked[s - 1])) s--
  if (!isId(masked[s])) return null
  let e = s
  while (s > 0 && isId(masked[s - 1])) s--
  while (isId(masked[e])) e++
  if (/^\d/.test(masked[s])) return null
  return [s, e]
}

// ---------------------------------------------------------------------------------------
// Type & member lookup
// ---------------------------------------------------------------------------------------

export function typesNamed(S: SymbolSource, name: string): SymRef[] {
  return S.byName(name).filter(s => isTypeKind(s.kind))
}

/** Members named `name` in `typeName` or (if none there) its base types. */
export function membersOf(S: SymbolSource, typeName: string, name: string, seen = new Set<string>()): SymRef[] {
  if (seen.has(typeName)) return []
  seen.add(typeName)
  const own = S.byContainer(typeName).filter(s => s.name === name)
  if (own.length) return own
  for (const t of typesNamed(S, typeName)) {
    for (const b of t.bases ?? []) {
      const r = membersOf(S, b, name, seen)
      if (r.length) return r
    }
  }
  return []
}

/** All members visible on a type: own first, then inherited (shadowed names dropped). */
export function allMembersOf(S: SymbolSource, typeName: string, seen = new Set<string>()): SymRef[] {
  if (seen.has(typeName)) return []
  seen.add(typeName)
  const own = S.byContainer(typeName)
  const names = new Set(own.map(s => s.name))
  const out = [...own]
  for (const t of typesNamed(S, typeName)) {
    for (const b of t.bases ?? []) {
      for (const m of allMembersOf(S, b, seen)) {
        if (names.has(m.name) || m.kind === 'constructor') continue
        names.add(m.name)
        out.push(m)
      }
    }
  }
  return out
}

/** Base-type names, transitively (stops at types not in the project). */
export function baseChain(S: SymbolSource, typeName: string): string[] {
  const out: string[] = []
  const seen = new Set([typeName])
  const queue = [typeName]
  while (queue.length) {
    const t = queue.shift()!
    for (const ty of typesNamed(S, t)) {
      for (const b of ty.bases ?? []) {
        if (seen.has(b)) continue
        seen.add(b); out.push(b); queue.push(b)
      }
    }
  }
  return out
}

export function isUnityBehaviour(S: SymbolSource, typeName: string): boolean {
  return baseChain(S, typeName).some(b => UNITY_BEHAVIOUR_BASES.has(b))
}

/** Types deriving from / implementing `typeName`, transitively. */
export function inheritorsOf(S: SymbolSource, typeName: string): SymRef[] {
  const all = S.allTypes()
  const out: SymRef[] = []
  const seen = new Set([typeName])
  const queue = [typeName]
  while (queue.length) {
    const t = queue.shift()!
    for (const ty of all) {
      if (!ty.bases?.includes(t)) continue
      const k = `${ty.path}:${ty.line}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(ty)
      if (!seen.has(ty.name)) { seen.add(ty.name); queue.push(ty.name) }
    }
  }
  return out
}

function elementType(t: string): string | null {
  const s = t.trim()
  if (/\[[\s,]*\]\??$/.test(s)) return s.replace(/\[[\s,]*\]\??$/, '')
  const m = /<([^<>]+)>/.exec(s)
  if (!m) return null
  const args = m[1].split(',').map(x => x.trim())
  return args[args.length - 1] || null   // List<T> → T, Dictionary<K,V> → V
}

const GENERIC_FACTORIES = /^(GetComponent|GetComponentInChildren|GetComponentInParent|AddComponent|FindObjectOfType|FindFirstObjectByType|FindAnyObjectByType|Instantiate|Load|LoadAsset|GetRequiredService|GetService|Get|Resolve|Create)$/

/** Unity members on behaviours, so `transform.` / `gameObject.` resolve to the right type. */
const UNITY_IMPLICIT: Record<string, string> = { transform: 'Transform', gameObject: 'GameObject', name: 'string', tag: 'string', enabled: 'bool' }

function enclosingType(doc: Doc, off: number): CsSymbol | null {
  return symbolAt(doc.file, off, k => k === 'class' || k === 'struct' || k === 'interface' || k === 'record' || k === 'enum')
}

/** Member lookup that also walks out through enclosing (nesting) types. */
function memberInScope(S: SymbolSource, doc: Doc, off: number, name: string): SymRef[] {
  const encl = enclosingType(doc, off)
  if (!encl) return []
  const path = [...(encl.container ? encl.container.split('.') : []), encl.name]
  for (let i = path.length - 1; i >= 0; i--) {
    const r = membersOf(S, path[i], name)
    if (r.length) return fresh(doc, r)
  }
  return []
}

/** Swap index copies of this file's symbols for ones parsed from the live buffer. */
function fresh(doc: Doc, syms: SymRef[]): SymRef[] {
  return syms.map(s => {
    if (s.path.toLowerCase() !== doc.path.toLowerCase()) return s
    const live = doc.file.symbols.find(x => x.name === s.name && x.kind === s.kind && x.container === s.container)
    return live ? { ...live, path: doc.path } : s
  })
}

const typeOfMember = (m: CsSymbol): string | null => (isTypeKind(m.kind) ? m.name : m.kind === 'enumMember' ? (m.type ?? null) : (m.type ?? null))

/** Type (as written) of a qualifier chain like ["player", "weapon"], or null. */
export function typeOfChain(S: SymbolSource, doc: Doc, chain: string[], at: number): string | null {
  let t: string | null = null
  const encl = enclosingType(doc, at)
  for (let i = 0; i < chain.length; i++) {
    const m = /^(@?[A-Za-z_]\w*)(<.*>)?((?:\(\)|\[\])*)$/.exec(chain[i])
    if (!m) return null
    const name = m[1].replace(/^@/, ''), gen = m[2], suf = m[3]
    const isCall = suf.startsWith('()')
    let ty: string | null = null
    if (isCall && gen && GENERIC_FACTORIES.test(name)) ty = gen.slice(1, -1).trim()
    else if (i === 0) {
      if (name === 'this') ty = encl?.name ?? null
      else if (name === 'base') ty = encl?.bases?.[0] ?? null
      else if (isCall) ty = memberInScope(S, doc, at, name).find(x => x.kind === 'method')?.type ?? null
      else {
        const local = findLocalDeclaration(doc.src, doc.masked, doc.file, at, name)
        if (local) ty = local.type ?? inferInitType(local.init)
        else {
          const mem = memberInScope(S, doc, at, name)[0]
          if (mem) ty = typeOfMember(mem)
          else if (typesNamed(S, name).length) ty = name
          else if (CS_BUILTIN_TYPES.has(name)) ty = name
          else ty = UNITY_IMPLICIT[name] ?? (/^[A-Z]/.test(name) ? name : null)   // static access to an external type
        }
      }
    } else {
      if (!t) return null
      const mem: SymRef | undefined = membersOf(S, simpleTypeName(t), name)[0]
      ty = mem ? typeOfMember(mem) : null
      if (!ty && t && !typesNamed(S, simpleTypeName(t)).length) return null
    }
    if (ty && suf.includes('[]')) ty = elementType(ty)
    if (ty === 'var') ty = null
    t = ty
    if (!t) return null
  }
  return t
}

// ---------------------------------------------------------------------------------------
// Resolve the identifier under the caret
// ---------------------------------------------------------------------------------------

export function resolveAt(S: SymbolSource, doc: Doc, off: number): Resolution {
  const r = wordRangeAt(doc.masked, off)
  if (!r) return { kind: 'none' }
  const [ws, we] = r
  const word = doc.masked.slice(ws, we)
  const p = posAt(doc.starts, ws)
  if (word === 'base' || word === 'this') {
    const encl = enclosingType(doc, ws)
    const name = word === 'base' ? encl?.bases?.[0] : encl?.name
    if (!name) return { kind: 'none' }
    const t = fresh(doc, typesNamed(S, name))
    return t.length ? { kind: 'symbols', word: name, targets: t, onDecl: false, exact: true, range: r } : { kind: 'external', word: name, typeName: name, range: r }
  }
  if (CS_KEYWORDS.has(word) && word !== 'value') return { kind: 'none' }

  // On a declaration in this file?
  const decl = doc.file.symbols.find(s => s.line === p.line && s.col === p.col)
  if (decl) return { kind: 'symbols', word, targets: [{ ...decl, path: doc.path }], onDecl: true, exact: true, range: r }

  const chain = qualifierChain(doc.masked, ws)
  if (!chain.length) {
    const local = findLocalDeclaration(doc.src, doc.masked, doc.file, ws, word)
    if (local) {
      const lp = posAt(doc.starts, local.offset)
      return {
        kind: 'local', word, decl: { path: doc.path, line: lp.line, col: lp.col, len: word.length },
        onDecl: local.offset === ws, type: local.type ?? inferInitType(local.init), isParam: local.isParam, range: r
      }
    }
    const mem = memberInScope(S, doc, ws, word)
    if (mem.length) return { kind: 'symbols', word, targets: mem, onDecl: false, exact: true, range: r }
    const types = fresh(doc, typesNamed(S, word))
    if (types.length) {
      // prefer types in this namespace / imported namespaces
      const ns = new Set([...doc.file.usings, enclosingType(doc, ws)?.namespace ?? ''])
      const pref = types.filter(t => ns.has(t.namespace) || [...ns].some(n => n && t.namespace.startsWith(n)))
      return { kind: 'symbols', word, targets: pref.length ? pref : types, onDecl: false, exact: true, range: r }
    }
    const any = fresh(doc, S.byName(word))
    if (any.length) return { kind: 'symbols', word, targets: any, onDecl: false, exact: false, range: r }
    return { kind: 'external', word, range: r }
  }

  const t = typeOfChain(S, doc, chain, ws)
  if (t) {
    const tn = simpleTypeName(t)
    const mem = fresh(doc, membersOf(S, tn, word))
    if (mem.length) return { kind: 'symbols', word, targets: mem, onDecl: false, exact: true, range: r }
    if (!typesNamed(S, tn).length || baseChain(S, tn).some(b => !typesNamed(S, b).length)) {
      // the type (or something it inherits from) lives outside the project
      const guess = fresh(doc, S.byName(word)).filter(s => !isTypeKind(s.kind))
      if (!typesNamed(S, tn).length) return { kind: 'external', word, typeName: tn, range: r }
      if (guess.length) return { kind: 'symbols', word, targets: guess, onDecl: false, exact: false, range: r }
      return { kind: 'external', word, typeName: tn, range: r }
    }
  }
  // Unknown qualifier (or a namespace path): fall back to anything with that name.
  const any = fresh(doc, S.byName(word))
  if (any.length) return { kind: 'symbols', word, targets: any, onDecl: false, exact: false, range: r }
  return { kind: 'external', word, typeName: t ? simpleTypeName(t) : undefined, range: r }
}

/** Offsets of a local's uses inside its member. */
export function localUsages(doc: Doc, declOffset: number, word: string): number[] {
  const member = symbolAt(doc.file, declOffset, k => k === 'method' || k === 'constructor' || k === 'property' || k === 'indexer' || k === 'event')
  const a = member?.start ?? 0, b = member?.end ?? doc.masked.length
  return wordOccurrences(doc.masked.slice(a, b), word).map(x => x + a).filter(o => {
    if (doc.masked[o - 1] === '.' || doc.masked[o - 2] === '.' && doc.masked[o - 1] === ' ') return false   // obj.word is a member
    return true
  })
}

// ---------------------------------------------------------------------------------------
// Implementations / super / type declaration
// ---------------------------------------------------------------------------------------

export function implementationsOf(S: SymbolSource, target: SymRef): SymRef[] {
  if (isTypeKind(target.kind)) return inheritorsOf(S, target.name)
  if (!target.container) return []
  const owner = lastSeg(target.container)
  const out: SymRef[] = []
  for (const t of inheritorsOf(S, owner)) out.push(...S.byContainer(t.name).filter(m => m.name === target.name && m.kind === target.kind))
  return out
}

/** Base declaration(s) of the member / type at the caret. */
export function superOf(S: SymbolSource, doc: Doc, off: number): { targets: SymRef[]; external?: string } {
  const member = symbolAt(doc.file, off, k => !isTypeKind(k) && k !== 'enumMember' && k !== 'namespace')
  const encl = enclosingType(doc, off)
  if (!encl) return { targets: [] }
  if (member && member.kind !== 'constructor' && member.kind !== 'field' && member.kind !== 'const') {
    for (const b of encl.bases ?? []) {
      const r = membersOf(S, b, member.name)
      if (r.length) return { targets: r }
    }
    if (UNITY_MESSAGE_MAP.has(member.name) && isUnityBehaviour(S, encl.name)) return { targets: [], external: 'MonoBehaviour' }
  }
  const out: SymRef[] = []
  for (const b of encl.bases ?? []) out.push(...typesNamed(S, b))
  return out.length ? { targets: out } : { targets: [], external: encl.bases?.[0] }
}

export function typeDeclarationAt(S: SymbolSource, doc: Doc, off: number): { targets: SymRef[]; external?: string } {
  const res = resolveAt(S, doc, off)
  let t: string | null = null
  if (res.kind === 'local') t = res.type
  else if (res.kind === 'symbols') {
    const s = res.targets[0]
    t = isTypeKind(s.kind) ? s.name : s.type ?? null
  } else if (res.kind === 'external') t = res.typeName ?? null
  if (!t) return { targets: [] }
  const tn = elementType(t) && /[[<]/.test(t) ? simpleTypeName(elementType(t)!) : simpleTypeName(t)
  const r = typesNamed(S, tn)
  return r.length ? { targets: fresh(doc, r) } : { targets: [], external: tn }
}

// ---------------------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------------------

export interface CompletionEntry {
  label: string
  kind: CsKind | 'local' | 'keyword' | 'unityMessage'
  detail?: string
  doc?: string
  insert?: string
  snippet?: boolean
  sort?: string
}

const LOCAL_DECL_RE = /(?:^|[\s(,;{}])(?:(?:ref|out|in|const|using|await)\s+)*(var|[A-Za-z_][\w.]*(?:\s*<[\w\s,.<>?[\]]*>)?(?:\s*\[[\s,]*\])*\??)\s+([A-Za-z_]\w*)\s*(?=[=;,)]|\bin\b)/g

export function localsAt(doc: Doc, off: number): { name: string; type: string; isParam: boolean }[] {
  const member = symbolAt(doc.file, off, k => k === 'method' || k === 'constructor' || k === 'property' || k === 'indexer')
  if (!member) return []
  const out = new Map<string, { name: string; type: string; isParam: boolean }>()
  for (const p of member.params ?? []) if (p.name) out.set(p.name, { name: p.name, type: p.type, isParam: true })
  const from = member.bodyStart ?? member.start
  if (off <= from) return [...out.values()]
  const body = doc.masked.slice(from, off)
  let m: RegExpExecArray | null
  LOCAL_DECL_RE.lastIndex = 0
  while ((m = LOCAL_DECL_RE.exec(body))) {
    const first = /^[A-Za-z_]\w*/.exec(m[1])?.[0]
    if (first && CS_KEYWORDS.has(first) && !CS_BUILTIN_TYPES.has(first) && first !== 'var') continue
    if (CS_KEYWORDS.has(m[2])) continue
    out.set(m[2], { name: m[2], type: m[1], isParam: false })
  }
  return [...out.values()]
}

const KEYWORD_LIST = [...CS_KEYWORDS]

export function completeAt(S: SymbolSource, doc: Doc, off: number): CompletionEntry[] {
  let ps = off
  while (ps > 0 && isId(doc.masked[ps - 1])) ps--
  const prefix = doc.masked.slice(ps, off)
  // in a comment / string?
  if (off > 0 && doc.masked[off - 1] === ' ' && doc.src[off - 1] !== ' ' && doc.src[off - 1] !== '\t') return []
  let k = ps - 1
  while (k >= 0 && /[ \t]/.test(doc.masked[k])) k--
  const out: CompletionEntry[] = []
  const add = (s: SymRef) => out.push({
    label: s.name, kind: s.kind, detail: s.signature, doc: s.doc, sort: s.kind === 'method' || s.kind === 'property' || s.kind === 'field' ? '1' : '3'
  })

  if (doc.masked[k] === '.') {
    const chain = qualifierChain(doc.masked, ps)
    if (!chain.length) return []
    const t = typeOfChain(S, doc, chain, ps)
    if (!t) {
      // maybe a namespace-qualified type / nested type: Outer.Inner
      const last = chain[chain.length - 1]
      const nested = S.byContainer(last)
      nested.forEach(add)
      return out
    }
    const tn = simpleTypeName(t)
    const members = allMembersOf(S, tn).filter(m => m.kind !== 'constructor')
    members.forEach(add)
    return out
  }

  const encl = enclosingType(doc, off)
  const member = symbolAt(doc.file, off, kk => kk === 'method' || kk === 'constructor' || kk === 'property' || kk === 'indexer' || kk === 'event')
  const inBody = !!member && off > (member.bodyStart ?? member.end)

  if (inBody) {
    for (const l of localsAt(doc, off)) out.push({ label: l.name, kind: 'local', detail: `${l.isParam ? 'parameter' : 'local'} ${l.type} ${l.name}`, sort: '0' })
  }
  if (encl) {
    const path = [...(encl.container ? encl.container.split('.') : []), encl.name]
    const seen = new Set(out.map(o => o.label))
    for (let i = path.length - 1; i >= 0; i--) {
      for (const m of allMembersOf(S, path[i])) {
        if (seen.has(m.name) || m.kind === 'constructor') continue
        seen.add(m.name)
        add(m)
      }
    }
    // Unity event functions at member level of a behaviour
    if (!inBody && isUnityBehaviour(S, encl.name)) {
      const have = new Set(doc.file.symbols.filter(s => s.container === (encl.container ? `${encl.container}.${encl.name}` : encl.name)).map(s => s.name))
      for (const msg of UNITY_MESSAGES) {
        if (have.has(msg.name)) continue
        const lineHead = doc.masked.slice(doc.starts[posAt(doc.starts, ps).line - 1], ps).trim().split(/\s+/)
        const prev = lineHead[lineHead.length - 1] ?? ''
        let sig = msg.signature
        if (prev === 'void') sig = sig.replace(/^void\s+/, '')
        else if (!['private', 'public', 'protected', 'internal'].includes(prev)) sig = `private ${sig}`
        out.push({
          label: msg.name, kind: 'unityMessage', detail: `Unity event function · ${msg.signature}`, doc: msg.doc, snippet: true,
          insert: `${sig}\n{\n\t$0\n}`, sort: '0'
        })
      }
    }
  }
  if (prefix.length >= 1) {
    const lower = prefix.toLowerCase()
    let n = 0
    for (const t of S.allTypes()) {
      if (!t.name.toLowerCase().startsWith(lower[0])) continue
      out.push({ label: t.name, kind: t.kind, detail: `${t.kind} ${t.namespace ? t.namespace + '.' : ''}${t.container ? t.container + '.' : ''}${t.name}`, doc: t.doc, sort: '2' })
      if (++n > 2000) break
    }
  }
  for (const kw of KEYWORD_LIST) out.push({ label: kw, kind: 'keyword', sort: '4' })
  // de-dupe by label+kind
  const seen = new Set<string>()
  return out.filter(o => { const key = `${o.label}|${o.kind}`; if (seen.has(key)) return false; seen.add(key); return true })
}

// ---------------------------------------------------------------------------------------
// Signature help
// ---------------------------------------------------------------------------------------

export interface SignatureInfo { signatures: { label: string; params: string[]; doc?: string }[]; activeSignature: number; activeParameter: number }

/** Open call around the caret: offset of its `(` and the arg index. */
export function openCallAt(masked: string, off: number): { paren: number; arg: number } | null {
  let depth = 0, commas = 0
  for (let i = off - 1; i >= 0 && off - i < 4000; i--) {
    const c = masked[i]
    if (c === ')' || c === ']') depth++
    else if (c === '(' || c === '[') {
      if (depth === 0) return c === '(' ? { paren: i, arg: commas } : null
      depth--
    } else if (depth === 0 && (c === ';' || c === '{' || c === '}')) return null
    else if (depth === 0 && c === ',') commas++
  }
  return null
}

function calleeBefore(masked: string, paren: number): { start: number; end: number; isNew: boolean } | null {
  let k = paren - 1
  while (k >= 0 && /\s/.test(masked[k])) k--
  if (masked[k] === '>') {   // generic args
    let d = 0
    for (; k >= 0; k--) { if (masked[k] === '>') d++; else if (masked[k] === '<') { d--; if (d === 0) break } }
    k--
    while (k >= 0 && /\s/.test(masked[k])) k--
  }
  const end = k + 1
  while (k >= 0 && isId(masked[k])) k--
  const start = k + 1
  if (start >= end) return null
  const before = masked.slice(Math.max(0, start - 6), start)
  return { start, end, isNew: /\bnew\s+$/.test(before) }
}

export function methodsForCall(S: SymbolSource, doc: Doc, paren: number): SymRef[] {
  const callee = calleeBefore(doc.masked, paren)
  if (!callee) return []
  const name = doc.masked.slice(callee.start, callee.end)
  if (CS_KEYWORDS.has(name)) return []
  if (callee.isNew) return fresh(doc, S.byContainer(name).filter(s => s.kind === 'constructor'))
  const res = resolveAt(S, doc, callee.start)
  if (res.kind !== 'symbols') return []
  const methods = res.targets.filter(t => t.kind === 'method' || t.kind === 'delegate')
  if (!methods.length) return []
  // all overloads with that name on the same container
  const c = methods[0].container
  if (methods[0].kind === 'method' && c) {
    const all = fresh(doc, membersOf(S, lastSeg(c), name)).filter(t => t.kind === 'method')
    if (all.length) return all
  }
  return methods
}

export function signatureAt(S: SymbolSource, doc: Doc, off: number): SignatureInfo | null {
  const call = openCallAt(doc.masked, off)
  if (!call) return null
  const methods = methodsForCall(S, doc, call.paren)
  if (!methods.length) return null
  const sigs = methods.map(m => {
    const params = (m.params ?? []).map(p => `${p.modifier ? p.modifier + ' ' : ''}${p.type} ${p.name}${p.def ? ' = ' + p.def : ''}`)
    const name = m.kind === 'constructor' ? m.name : `${m.type ?? 'void'} ${m.name}`
    return { label: `${name}(${params.join(', ')})`, params, doc: m.doc }
  })
  let active = sigs.findIndex(s => s.params.length > call.arg)
  if (active < 0) active = 0
  return { signatures: sigs, activeSignature: active, activeParameter: call.arg }
}

// ---------------------------------------------------------------------------------------
// Inlay parameter-name hints (Rider shows them for literal arguments)
// ---------------------------------------------------------------------------------------

export interface InlayHint { line: number; col: number; label: string }

const NO_CALL = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'nameof', 'typeof', 'sizeof', 'default', 'return', 'when', 'fixed', 'checked', 'unchecked', 'base', 'this'])

export function inlayHints(S: SymbolSource, doc: Doc, fromLine: number, toLine: number): InlayHint[] {
  const a = doc.starts[Math.max(0, fromLine - 1)] ?? 0
  const b = doc.starts[Math.min(doc.starts.length - 1, toLine)] ?? doc.masked.length
  const text = doc.masked.slice(a, b)
  const out: InlayHint[] = []
  const re = /([A-Za-z_]\w*)\s*(?:<[^()<>;]*>)?\s*\(/g
  let m: RegExpExecArray | null, calls = 0
  const declOffsets = new Set(doc.file.symbols.map(s => doc.starts[s.line - 1] + s.col - 1))
  while ((m = re.exec(text)) && calls < 400) {
    const nameStart = a + m.index
    if (NO_CALL.has(m[1]) || declOffsets.has(nameStart)) continue
    const paren = a + m.index + m[0].length - 1
    // argument ranges
    const args: [number, number][] = []
    let depth = 0, start = paren + 1, i = paren + 1
    for (; i < doc.masked.length && i < paren + 2000; i++) {
      const c = doc.masked[i]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth-- }
      else if (c === ',' && depth === 0) { args.push([start, i]); start = i + 1 }
      else if (c === ';' && depth === 0) break
    }
    if (doc.masked[i] !== ')') continue
    if (doc.masked.slice(start, i).trim()) args.push([start, i])
    const lits = args.map(([x, y]) => {
      const s = doc.src.slice(x, y).trim()
      return /^(?:-?\d[\d_.]*[fFdDmMuUlL]?|"(?:[^"\\]|\\.)*"|@".*"|\$".*"|'(?:[^'\\]|\\.)+'|true|false|null|default)$/.test(s) && !/^\w+\s*:/.test(s)
    })
    if (!lits.some(Boolean)) continue
    calls++
    const methods = methodsForCall(S, doc, paren)
    if (!methods.length) continue
    const target = methods.find(mm => (mm.params?.length ?? 0) >= args.length && (mm.params?.length ?? 0) - (mm.params?.filter(p => p.def !== undefined).length ?? 0) <= args.length) ?? methods[0]
    args.forEach(([x], idx) => {
      if (!lits[idx]) return
      const p = target.params?.[idx]
      if (!p?.name || p.modifier === 'params') return
      let s = x
      while (/\s/.test(doc.masked[s])) s++
      const pos = posAt(doc.starts, s)
      out.push({ line: pos.line, col: pos.col, label: `${p.name}:` })
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------
// Code Vision + gutter marks
// ---------------------------------------------------------------------------------------

export interface LensInfo {
  line: number
  col: number
  name: string
  kind: CsKind
  usages: number
  /** types: inheritors; abstract/virtual/interface members: implementations */
  implementations?: number
  unityEvent?: boolean
  unityScript?: boolean
  overrides?: boolean       // overrides / implements a base member (gutter ↑)
}

export function lensInfo(S: SymbolSource, doc: Doc): LensInfo[] {
  const out: LensInfo[] = []
  const unityCache = new Map<string, boolean>()
  const isUnity = (t: string) => { let v = unityCache.get(t); if (v === undefined) { v = isUnityBehaviour(S, t); unityCache.set(t, v) } return v }
  for (const s of doc.file.symbols) {
    if (s.kind === 'enumMember' || s.kind === 'namespace') continue
    const declCount = S.byName(s.name).length || 1
    const usages = Math.max(0, S.wordCount(s.name) - declCount)
    const info: LensInfo = { line: s.line, col: s.col, name: s.name, kind: s.kind, usages }
    const owner = s.container ? lastSeg(s.container) : null
    if (isTypeKind(s.kind)) {
      if (s.kind === 'class' || s.kind === 'interface' || s.kind === 'record') {
        const n = inheritorsOf(S, s.name).length
        if (n) info.implementations = n
      }
      if (s.kind === 'class' && isUnity(s.name)) info.unityScript = true
    } else if (owner && (s.kind === 'method' || s.kind === 'property' || s.kind === 'event')) {
      const ownerSym = doc.file.symbols.find(t => isTypeKind(t.kind) && t.name === owner)
      const virtualish = ownerSym?.kind === 'interface' || s.modifiers.some(m => m === 'virtual' || m === 'abstract' || m === 'override')
      if (virtualish) {
        const n = implementationsOf(S, { ...s, path: doc.path }).length
        if (n) info.implementations = n
      }
      if (s.modifiers.includes('override')) info.overrides = true
      else if (ownerSym?.bases?.length && ownerSym.kind !== 'interface') {
        info.overrides = ownerSym.bases.some(b => membersOf(S, b, s.name).length > 0)
      }
      if (s.kind === 'method' && UNITY_MESSAGE_MAP.has(s.name) && !s.modifiers.includes('static') && isUnity(owner)) info.unityEvent = true
    }
    out.push(info)
  }
  return out
}

// ---------------------------------------------------------------------------------------
// Generate › Override / implement members
// ---------------------------------------------------------------------------------------

/** Base members the type at the caret could override / still has to implement. */
export function overridableAt(S: SymbolSource, doc: Doc, off: number): { member: SymRef; mode: 'override' | 'implement' }[] {
  const encl = enclosingType(doc, off)
  if (!encl || encl.kind === 'interface' || encl.kind === 'enum') return []
  const ownerPath = encl.container ? `${encl.container}.${encl.name}` : encl.name
  const own = new Set(doc.file.symbols.filter(s => s.container === ownerPath).map(s => s.name))
  const out: { member: SymRef; mode: 'override' | 'implement' }[] = []
  const seen = new Set<string>()
  const visit = (typeName: string, depth: number) => {
    if (depth > 8) return
    for (const t of typesNamed(S, typeName)) {
      for (const m of S.byContainer(t.name)) {
        if (own.has(m.name) || seen.has(m.name) || m.kind === 'constructor' || isTypeKind(m.kind)) continue
        if (t.kind === 'interface' && (m.kind === 'method' || m.kind === 'property' || m.kind === 'event')) {
          seen.add(m.name); out.push({ member: m, mode: 'implement' })
        } else if (m.modifiers.some(x => x === 'virtual' || x === 'abstract' || x === 'override') && !m.modifiers.includes('sealed')) {
          seen.add(m.name); out.push({ member: m, mode: 'override' })
        }
      }
      for (const b of t.bases ?? []) visit(b, depth + 1)
    }
  }
  for (const b of encl.bases ?? []) visit(b, 0)
  return out
}
