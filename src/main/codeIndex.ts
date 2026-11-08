import { readFile, stat } from 'fs/promises'
import { watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { listFiles } from './fileTree'
import { maskCode, parseCSharp, countWords, wordOccurrences, lineStartsOf, posAt, fuzzyName, isTypeKind, type CsFile } from '../shared/csharp'
import {
  makeDoc, resolveAt, completeAt, signatureAt, inlayHints, lensInfo, implementationsOf, superOf, typeDeclarationAt,
  localUsages, typesNamed, overridableAt, type Doc, type SymRef, type SymbolSource
} from '../shared/csharpAnalysis'

/**
 * Project-wide C# index (one per project root): symbols of every .cs file, identifier
 * counts for Code Vision, and the text needed for Find Usages. Built in the background,
 * kept fresh by a recursive watcher, and overlaid with unsaved editor buffers so
 * navigation sees what the user sees.
 */

const SKIP = /(^|[\\/])(Library|Temp|Logs|obj|bin|UserSettings|Build|Builds|node_modules|\.git|\.vs|\.idea)([\\/]|$)/
const MAX_FILE = 2 * 1024 * 1024
const key = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

interface Entry { path: string; text: string; masked: string; file: CsFile; words: Map<string, number>; overlay: boolean }

export interface Usage { path: string; line: number; col: number; len: number; text: string; preview: [number, number]; decl: boolean }

/** Trimmed line text + where the hit sits in it. */
function previewOf(line: string, col: number, len: number): { text: string; preview: [number, number] } {
  const raw = line.replace(/\r$/, '')
  const lead = raw.length - raw.trimStart().length
  const a = Math.max(0, col - 1 - lead)
  return { text: raw.trim().slice(0, 240), preview: [a, a + len] }
}
export interface IndexStatus { state: 'idle' | 'indexing' | 'ready'; done: number; total: number; files: number; symbols: number }

export class CodeIndex implements SymbolSource {
  private files = new Map<string, Entry>()
  private counts = new Map<string, number>()
  private names: Map<string, SymRef[]> | null = null
  private containers: Map<string, SymRef[]> | null = null
  private types: SymRef[] | null = null
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private pendingTimer: NodeJS.Timeout | null = null
  private changedTimer: NodeJS.Timeout | null = null
  private building: Promise<void> | null = null
  private docCache: Doc | null = null
  status: IndexStatus = { state: 'idle', done: 0, total: 0, files: 0, symbols: 0 }

  constructor(readonly root: string, private emit: (ev: 'progress' | 'changed', status: IndexStatus) => void) {}

  // ---------------------------------------------------------------- building

  ready(): Promise<void> {
    if (!this.building) this.building = this.build()
    return this.building
  }

  private async build() {
    this.status = { ...this.status, state: 'indexing', done: 0, total: 0 }
    let rels: string[] = []
    try { rels = (await listFiles(this.root, 100000)).filter(r => r.toLowerCase().endsWith('.cs')) } catch { /* unreadable root */ }
    this.status.total = rels.length
    this.emit('progress', this.status)
    let lastEmit = Date.now()
    for (let i = 0; i < rels.length; i++) {
      const abs = join(this.root, rels[i])
      if (!this.files.has(key(abs))) await this.loadFromDisk(abs)
      this.status.done = i + 1
      if (i % 25 === 0) await new Promise(r => setImmediate(r))   // keep the main process responsive
      if (Date.now() - lastEmit > 250) { lastEmit = Date.now(); this.emit('progress', this.status) }
    }
    this.status.state = 'ready'
    this.refreshStats()
    this.emit('progress', this.status)
    this.emit('changed', this.status)
    this.startWatching()
  }

  private refreshStats() {
    this.status.files = this.files.size
    let n = 0
    for (const e of this.files.values()) n += e.file.symbols.length
    this.status.symbols = n
  }

  private async loadFromDisk(abs: string) {
    try {
      const st = await stat(abs)
      if (!st.isFile() || st.size > MAX_FILE) { this.remove(abs); return }
      let text = await readFile(abs, 'utf8')
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      this.put(abs, text, false)
    } catch {
      this.remove(abs)
    }
  }

  private put(path: string, text: string, overlay: boolean) {
    const k = key(path)
    const old = this.files.get(k)
    if (old && old.text === text) { old.overlay = overlay; return }
    if (old) this.adjustCounts(old.words, -1)
    const masked = maskCode(text)
    let file: CsFile
    try { file = parseCSharp(text, masked) } catch { file = { usings: [], symbols: [] } }
    const words = countWords(masked)
    this.files.set(k, { path, text, masked, file, words, overlay })
    this.adjustCounts(words, 1)
    this.invalidate()
  }

  private remove(path: string) {
    const k = key(path)
    const old = this.files.get(k)
    if (!old) return
    this.adjustCounts(old.words, -1)
    this.files.delete(k)
    this.invalidate()
  }

  private adjustCounts(words: Map<string, number>, sign: 1 | -1) {
    for (const [w, n] of words) {
      const v = (this.counts.get(w) ?? 0) + sign * n
      if (v > 0) this.counts.set(w, v); else this.counts.delete(w)
    }
  }

  private invalidate() {
    this.names = null; this.containers = null; this.types = null
    if (this.status.state !== 'ready') return
    if (this.changedTimer) clearTimeout(this.changedTimer)
    this.changedTimer = setTimeout(() => { this.refreshStats(); this.emit('changed', this.status) }, 400)
  }

  private startWatching() {
    if (this.watcher) return
    try {
      this.watcher = watch(this.root, { recursive: true }, (_ev, f) => {
        if (!f) return
        const rel = f.toString()
        if (!rel.toLowerCase().endsWith('.cs') || SKIP.test(rel)) return
        this.pending.add(join(this.root, rel))
        if (this.pendingTimer) clearTimeout(this.pendingTimer)
        this.pendingTimer = setTimeout(() => void this.flushPending(), 200)
      })
      this.watcher.on('error', () => { this.watcher?.close(); this.watcher = null })
    } catch { /* no live updates */ }
  }

  private async flushPending() {
    const paths = [...this.pending]
    this.pending.clear()
    for (const p of paths) {
      if (this.files.get(key(p))?.overlay) continue   // an editor buffer owns this file
      await this.loadFromDisk(p)
    }
  }

  /** An editor buffer changed (text) or was closed (null → back to the disk copy). */
  async update(path: string, text: string | null) {
    if (!path.toLowerCase().endsWith('.cs')) return
    await this.ready()
    if (text === null) await this.loadFromDisk(path)
    else this.put(path, text, true)
  }

  dispose() {
    this.watcher?.close()
    this.watcher = null
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    if (this.changedTimer) clearTimeout(this.changedTimer)
  }

  // ---------------------------------------------------------------- SymbolSource

  private buildMaps() {
    if (this.names) return
    const names = new Map<string, SymRef[]>()
    const containers = new Map<string, SymRef[]>()
    const types: SymRef[] = []
    for (const e of this.files.values()) {
      for (const s of e.file.symbols) {
        const r: SymRef = { ...s, path: e.path }
        let a = names.get(s.name); if (!a) names.set(s.name, a = []); a.push(r)
        if (s.container) {
          const c = s.container.slice(s.container.lastIndexOf('.') + 1)
          let b = containers.get(c); if (!b) containers.set(c, b = []); b.push(r)
        }
        if (isTypeKind(s.kind)) types.push(r)
      }
    }
    this.names = names; this.containers = containers; this.types = types
  }

  byName(name: string): SymRef[] { this.buildMaps(); return this.names!.get(name) ?? [] }
  byContainer(typeName: string): SymRef[] { this.buildMaps(); return this.containers!.get(typeName) ?? [] }
  allTypes(): SymRef[] { this.buildMaps(); return this.types! }
  wordCount(name: string): number { return this.counts.get(name) ?? 0 }

  // ---------------------------------------------------------------- queries

  private doc(path: string, src?: string): Doc | null {
    if (src === undefined) {
      const e = this.files.get(key(path))
      if (!e) return null
      src = e.text
    }
    const c = this.docCache
    if (c && c.path === path && c.src === src) return c
    this.docCache = makeDoc(path, src)
    return this.docCache
  }

  resolve(path: string, src: string, offset: number) { const d = this.doc(path, src)!; return resolveAt(this, d, offset) }
  complete(path: string, src: string, offset: number) { return completeAt(this, this.doc(path, src)!, offset) }
  signature(path: string, src: string, offset: number) { return signatureAt(this, this.doc(path, src)!, offset) }
  inlay(path: string, src: string, from: number, to: number) { return inlayHints(this, this.doc(path, src)!, from, to) }
  lens(path: string, src: string) { return lensInfo(this, this.doc(path, src)!) }
  superOf(path: string, src: string, offset: number) { return superOf(this, this.doc(path, src)!, offset) }
  typeDecl(path: string, src: string, offset: number) { return typeDeclarationAt(this, this.doc(path, src)!, offset) }
  implementations(target: SymRef) { return implementationsOf(this, target) }
  overridable(path: string, src: string, offset: number) { return overridableAt(this, this.doc(path, src)!, offset) }

  /** Offsets → usages of a local inside the current buffer. */
  localUsages(path: string, src: string, declLine: number, declCol: number, word: string): Usage[] {
    const d = this.doc(path, src)!
    const lines = src.split('\n')
    const declOff = d.starts[declLine - 1] + declCol - 1
    return localUsages(d, declOff, word).map(o => {
      const p = posAt(d.starts, o)
      return { path, line: p.line, col: p.col, len: word.length, ...previewOf(lines[p.line - 1], p.col, word.length), decl: o === declOff }
    })
  }

  /**
   * Whole-word occurrences of `name` in every C# file. With a target symbol, other symbols'
   * declarations with the same name are skipped (so "Update" doesn't list every Update()).
   */
  usages(name: string, target?: { path: string; line: number; col: number } | null, limit = 5000): Usage[] {
    const out: Usage[] = []
    const all = this.byName(name)
    const otherDecls = new Set(all.filter(s => !target || !(key(s.path) === key(target.path) && s.line === target.line && s.col === target.col))
      .map(s => `${key(s.path)}:${s.line}:${s.col}`))
    for (const e of this.files.values()) {
      if (!e.words.has(name)) continue
      const starts = lineStartsOf(e.text)
      let lines: string[] | null = null
      for (const o of wordOccurrences(e.masked, name)) {
        const p = posAt(starts, o)
        const k = `${key(e.path)}:${p.line}:${p.col}`
        const isTarget = !!target && key(e.path) === key(target.path) && p.line === target.line && p.col === target.col
        if (target && !isTarget && otherDecls.has(k)) continue
        lines ??= e.text.split('\n')
        out.push({ path: e.path, line: p.line, col: p.col, len: name.length, ...previewOf(lines[p.line - 1], p.col, name.length), decl: isTarget || otherDecls.has(k) })
        if (out.length >= limit) return out
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.col - b.col)
  }

  /** Go to Symbol / Go to Class / Search Everywhere. */
  search(query: string, scope: 'types' | 'symbols', limit = 200): SymRef[] {
    this.buildMaps()
    const pool = scope === 'types' ? this.types! : [...this.names!.values()].flat().filter(s => s.kind !== 'namespace')
    const q = query.trim()
    if (!q) return pool.slice(0, limit)
    // "Player.Move" → member Move of a type matching Player
    const dot = q.lastIndexOf('.')
    const head = dot > 0 ? q.slice(0, dot) : null
    const tail = dot > 0 ? q.slice(dot + 1) : q
    const scored: { s: SymRef; n: number }[] = []
    for (const s of pool) {
      let n = fuzzyName(tail, s.name)
      if (n < 0) continue
      if (head) {
        const h = fuzzyName(head.split('.').pop()!, s.container?.split('.').pop() ?? '')
        if (h < 0) continue
        n += h
      }
      if (isTypeKind(s.kind)) n += 5
      scored.push({ s, n })
    }
    return scored.sort((a, b) => b.n - a.n || a.s.name.length - b.s.name.length).slice(0, limit).map(x => x.s)
  }

  /** Namespaces declaring a type with this name (for "Import namespace" quick fixes). */
  namespacesFor(name: string): string[] {
    return [...new Set(typesNamed(this, name).map(t => t.namespace).filter(Boolean))]
  }

  fileSymbols(path: string): SymRef[] {
    const e = this.files.get(key(path))
    return e ? e.file.symbols.map(s => ({ ...s, path: e.path })) : []
  }
}

// ---------------------------------------------------------------- registry

const indexes = new Map<string, CodeIndex>()

export function getIndex(root: string, emit: (root: string, ev: 'progress' | 'changed', s: IndexStatus) => void): CodeIndex {
  const k = key(root)
  let ix = indexes.get(k)
  if (!ix) {
    ix = new CodeIndex(root, (ev, s) => emit(root, ev, s))
    indexes.set(k, ix)
    void ix.ready()
  }
  return ix
}

export function disposeIndexes() {
  for (const ix of indexes.values()) ix.dispose()
  indexes.clear()
}
