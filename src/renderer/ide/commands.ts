import { monaco } from './monaco'
import { isTypeKind } from '@shared/csharp'
import type { Resolution, SymRef } from '@shared/csharpAnalysis'
import { UNITY_MESSAGES, unityDocsUrl } from '@shared/unityApi'
import type { Usage } from '../../main/codeIndex'
import {
  ideCtx, getEditor, getActivePath, isCSharp, navigateTo, goBack, goForward, docFor, caretAnchor,
  showEditorMessage, codeQuery
} from './context'
import { getEntry, saveAll } from './models'
import { baseName, fileKey, relativeTo } from './paths'
import { useIde } from '../store/ideStore'
import { useDebug } from '../store/debugStore'
import { useNav, type PopupItem, type FindItem } from '../store/navStore'
import { ACTIONS, shortcutLabel } from './keymap'
import { SURROUND_TEMPLATES, snippetEscape } from './templates'
import { refreshInsight } from './codeInsight'

/**
 * Every IDE command (`arw.*` ids from ide/keymap.ts), plus running plain Monaco actions.
 * Returns true when the command applied (window-level keys only swallow the event then).
 */
export function runCommand(id: string): boolean {
  const fn = COMMANDS[id]
  if (fn) {
    const r = fn()
    if (r instanceof Promise) { void r.catch(err => showEditorMessage(String(err?.message ?? err))); return true }
    return r !== false
  }
  const ed = getEditor()
  if (!ed || !ed.getModel()) return false
  ed.focus()
  ed.trigger('keyboard', id, null)
  return true
}

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

function at() {
  const ed = getEditor(), path = getActivePath()
  const model = ed?.getModel(), pos = ed?.getPosition()
  if (!ed || !path || !model || !pos) return null
  return { ed, path, model, pos, src: model.getValue(), offset: model.getOffsetAt(pos) }
}

const locOf = (s: { path: string; line: number; col: number }) => ({ path: s.path, line: s.line, col: s.col })
const rel = (p: string) => relativeTo(ideCtx.root, p)
const dirOf = (p: string) => { const r = rel(p); return r.slice(0, Math.max(0, r.length - baseName(r).length - 1)) }

function symbolItem(s: SymRef, onPick?: () => void): PopupItem {
  return {
    id: `${s.path}:${s.line}:${s.col}`, label: s.name, icon: s.kind,
    detail: s.container ? `${s.container}` : s.namespace || undefined,
    hint: `${baseName(s.path)}:${s.line}`,
    onPick: onPick ?? (() => navigateTo(locOf(s)))
  }
}

function choose(title: string, syms: SymRef[]) {
  useNav.getState().open({ type: 'list', title, anchor: caretAnchor(), items: syms.map(s => symbolItem(s)) })
}

function usageItems(us: (Usage | FindItem)[]): PopupItem[] {
  return us.map(u => ({
    id: `${u.path}:${u.line}:${u.col}`, label: u.text, mark: u.preview, icon: 'usage',
    hint: `${baseName(u.path)}:${u.line}`, onPick: () => navigateTo(locOf(u))
  }))
}

async function resolveHere(): Promise<{ res: Resolution; ctx: NonNullable<ReturnType<typeof at>> } | null> {
  const c = at()
  if (!c) return null
  if (!isCSharp(c.path)) { showEditorMessage('Code navigation works in C# files'); return null }
  const res = await codeQuery<Resolution>('resolve', { path: c.path, src: c.src, offset: c.offset })
  return { res, ctx: c }
}

function targetUsages(t: { path: string; line: number; col: number; name: string; kind?: string }): Promise<Usage[]> {
  // Renaming / finding a type must include its constructors, so don't exclude other declarations.
  const exclude = !(t.kind && isTypeKind(t.kind as any))
  return codeQuery<Usage[]>('usages', { name: t.name, target: exclude ? { path: t.path, line: t.line, col: t.col } : null })
}

async function showUsagesPopup(t: { path: string; line: number; col: number; name: string; kind?: string }) {
  const us = (await targetUsages(t)).filter(u => !u.decl)
  if (!us.length) { showEditorMessage(`No usages of '${t.name}' found in the project`); return }
  if (us.length === 1) { navigateTo(locOf(us[0])); return }
  useNav.getState().open({
    type: 'list', title: `Usages of ${t.name} · ${us.length}`, anchor: caretAnchor(), items: usageItems(us),
    footer: { label: `Open in Find window (${shortcutLabel('FindUsages') || 'Alt+F7'})`, onClick: () => showInFind(`Usages of '${t.name}'`, us) }
  })
}

function showInFind(title: string, us: (Usage | FindItem)[]) {
  useNav.getState().showFind({ mode: 'usages', title, items: us.map(u => ({ ...u, decl: 'decl' in u ? u.decl : undefined })) })
}

function externalPopup(word: string, typeName?: string) {
  const full = typeName && typeName !== word ? `${typeName}.${word}` : word
  useNav.getState().open({
    type: 'list', title: `'${full}' is declared outside the project`, anchor: caretAnchor(),
    items: [
      { id: 'docs', label: `Search Unity docs for ${full}`, icon: 'web', onPick: () => window.arw.openExternal(unityDocsUrl(full)) },
      { id: 'find', label: `Find '${word}' in project files`, icon: 'search', onPick: () => openFindInFiles(word, false, true) }
    ]
  })
}

// ---------------------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------------------

async function gotoDeclaration() {
  const r = await resolveHere()
  if (!r) return
  const { res } = r
  if (res.kind === 'none') return showEditorMessage('Cannot find declaration to go to')
  if (res.kind === 'external') return externalPopup(res.word, res.typeName)
  if (res.kind === 'local') {
    if (res.onDecl) return showLocalUsages(r.ctx, res)
    return navigateTo(locOf(res.decl))
  }
  if (res.onDecl) return showUsagesPopup(res.targets[0])
  if (res.targets.length === 1) return navigateTo(locOf(res.targets[0]))
  choose(res.exact ? `Choose Declaration of ${res.word}` : `Choose Declaration of ${res.word} (by name)`, res.targets)
}

async function showLocalUsages(c: NonNullable<ReturnType<typeof at>>, res: Extract<Resolution, { kind: 'local' }>) {
  const us = (await codeQuery<Usage[]>('localUsages', { path: c.path, src: c.src, line: res.decl.line, col: res.decl.col, name: res.word })).filter(u => !u.decl)
  if (!us.length) return showEditorMessage(`'${res.word}' is never used`)
  if (us.length === 1) return navigateTo(locOf(us[0]))
  useNav.getState().open({ type: 'list', title: `Usages of ${res.word} · ${us.length}`, anchor: caretAnchor(), items: usageItems(us) })
}

async function findUsages() {
  const r = await resolveHere()
  if (!r) return
  const { res, ctx } = r
  if (res.kind === 'none') return showEditorMessage('Place the caret on a symbol to find its usages')
  if (res.kind === 'external') return openFindInFiles(res.word, false, true)
  if (res.kind === 'local') {
    const us = await codeQuery<Usage[]>('localUsages', { path: ctx.path, src: ctx.src, line: res.decl.line, col: res.decl.col, name: res.word })
    return showInFind(`Usages of local '${res.word}'`, us.filter(u => !u.decl))
  }
  const t = res.targets[0]
  const us = await targetUsages(t)
  showInFind(`Usages of ${t.kind === 'enumMember' ? 'enum member' : t.kind} '${t.container ? t.container + '.' : ''}${t.name}'`, us.filter(u => !u.decl))
}

async function showUsages() {
  const r = await resolveHere()
  if (!r) return
  const { res, ctx } = r
  if (res.kind === 'local') return showLocalUsages(ctx, res)
  if (res.kind === 'symbols') return showUsagesPopup(res.targets[0])
  if (res.kind === 'external') return externalPopup(res.word, res.typeName)
  showEditorMessage('Place the caret on a symbol to show its usages')
}

async function gotoImplementation() {
  const r = await resolveHere()
  if (!r) return
  const { res } = r
  if (res.kind !== 'symbols') return showEditorMessage('No implementations found')
  const t = res.targets[0]
  const impls = await codeQuery<SymRef[]>('implementations', { target: t })
  if (!impls.length) return showEditorMessage(`No implementations of '${t.name}' found`)
  if (impls.length === 1) return navigateTo(locOf(impls[0]))
  choose(`Implementations of ${t.name}`, impls)
}

async function gotoSuper() {
  const c = at()
  if (!c || !isCSharp(c.path)) return
  const r = await codeQuery<{ targets: SymRef[]; external?: string }>('super', { path: c.path, src: c.src, offset: c.offset })
  if (r.targets.length === 1) return navigateTo(locOf(r.targets[0]))
  if (r.targets.length) return choose('Choose Base Symbol', r.targets)
  showEditorMessage(r.external ? `Base symbol is in '${r.external}' (outside the project)` : 'No base symbols found')
}

async function gotoTypeDeclaration() {
  const c = at()
  if (!c || !isCSharp(c.path)) return
  const r = await codeQuery<{ targets: SymRef[]; external?: string }>('typeDecl', { path: c.path, src: c.src, offset: c.offset })
  if (r.targets.length === 1) return navigateTo(locOf(r.targets[0]))
  if (r.targets.length) return choose('Choose Type', r.targets)
  if (r.external) return externalPopup(r.external)
  showEditorMessage('Cannot find type declaration')
}

function jumpMember(dir: 1 | -1) {
  const c = at()
  if (!c || !isCSharp(c.path)) return
  const doc = docFor(c.model, c.path)
  const lines = [...new Set(doc.file.symbols
    .filter(s => s.kind === 'method' || s.kind === 'constructor' || s.kind === 'property' || s.kind === 'indexer' || s.kind === 'event' || isTypeKind(s.kind))
    .map(s => s.line))].sort((a, b) => a - b)
  const cur = c.pos.lineNumber
  const target = dir > 0 ? lines.find(l => l > cur) : [...lines].reverse().find(l => l < cur)
  if (!target) return
  const s = doc.file.symbols.find(x => x.line === target)!
  c.ed.setPosition({ lineNumber: target, column: s.col })
  c.ed.revealLineInCenterIfOutsideViewport(target)
}

function fileStructure() {
  const c = at()
  if (!c) return
  if (!isCSharp(c.path)) { runCommand('editor.action.quickOutline'); return }
  const doc = docFor(c.model, c.path)
  const syms = [...doc.file.symbols].sort((a, b) => a.start - b.start)
  const depthOf = (s: typeof syms[number]) => (s.container ? s.container.split('.').length : 0)
  let initial = 0
  syms.forEach((s, i) => { if (s.start <= c.offset && c.offset <= s.end) initial = i })
  useNav.getState().open({
    type: 'list', title: `${baseName(c.path)} — File Structure`, filter: true, initialIndex: initial,
    items: syms.map(s => ({
      id: `${s.line}:${s.col}`, label: s.name, icon: s.kind, depth: depthOf(s),
      detail: s.kind === 'method' || s.kind === 'constructor' ? `(${(s.params ?? []).map(p => p.type).join(', ')})${s.type ? ' : ' + s.type : ''}` : s.type ? `: ${s.type}` : undefined,
      onPick: () => navigateTo({ path: c.path, line: s.line, col: s.col })
    }))
  })
}

function recentFiles(switcher: boolean) {
  const st = useNav.getState()
  const active = useIde.getState().tabs[ideCtx.projectId]?.active
  let list = st.recent
  if (active && !list.some(p => fileKey(p) === fileKey(active))) list = [active, ...list]
  if (!list.length) return
  st.open({
    type: 'list', title: switcher ? 'Switcher' : 'Recent Files', filter: !switcher, initialIndex: list.length > 1 ? 1 : 0,
    releaseCtrlPicks: switcher,
    items: list.map(p => ({ id: p, label: baseName(p), detail: dirOf(p), icon: 'file', onPick: () => useIde.getState().openFile(ideCtx.projectId, p) }))
  })
}

function showBookmarks() {
  const bms = useIde.getState().bookmarks
  const items: PopupItem[] = []
  for (const b of Object.values(bms)) {
    const model = getEntry(b.path)?.model
    for (const l of b.lines) {
      const text = model && l <= model.getLineCount() ? model.getLineContent(l).trim() : ''
      items.push({ id: `${b.path}:${l}`, label: `${baseName(b.path)}:${l}`, detail: text || dirOf(b.path), icon: 'bookmark', onPick: () => navigateTo({ path: b.path, line: l, col: 1 }) })
    }
  }
  if (!items.length) { showEditorMessage('No bookmarks yet — F11 toggles one on the caret line'); return }
  useNav.getState().open({ type: 'list', title: 'Bookmarks', filter: true, items })
}

// ---------------------------------------------------------------------------------------
// find in files
// ---------------------------------------------------------------------------------------

export function openFindInFiles(text?: string, replace = false, wholeWord = false) {
  const st = useNav.getState()
  const ed = getEditor()
  let q = text
  if (q === undefined && ed) {
    const sel = ed.getSelection(), model = ed.getModel()
    if (sel && model && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber) q = model.getValueInRange(sel)
    else if (sel && model) q = model.getWordAtPosition(sel.getPosition())?.word
  }
  const prev = st.find?.mode === 'text' ? st.find.query : undefined
  st.showFind({
    mode: 'text', title: replace ? 'Replace in Files' : 'Find in Files', items: [], showReplace: replace,
    query: { text: q ?? prev?.text ?? '', regex: prev?.regex ?? false, matchCase: prev?.matchCase ?? false, wholeWord: wholeWord || (prev?.wholeWord ?? false), mask: prev?.mask ?? '', replace: prev?.replace ?? '' }
  })
}

// ---------------------------------------------------------------------------------------
// refactoring
// ---------------------------------------------------------------------------------------

async function rename() {
  const c = at()
  if (!c) return
  if (!isCSharp(c.path)) { runCommand('editor.action.changeAll'); return }
  const res = await codeQuery<Resolution>('resolve', { path: c.path, src: c.src, offset: c.offset })
  if (res.kind === 'local') {
    const us = await codeQuery<Usage[]>('localUsages', { path: c.path, src: c.src, line: res.decl.line, col: res.decl.col, name: res.word })
    useNav.getState().open({ type: 'rename', title: `Rename ${res.isParam ? 'parameter' : 'local variable'}`, name: res.word, occurrences: us, files: 1 })
    return
  }
  if (res.kind !== 'symbols') return showEditorMessage(res.kind === 'external' ? 'Cannot rename a symbol declared outside the project' : 'Place the caret on a symbol to rename it')
  const t = res.targets[0]
  const us = await targetUsages(t)
  if (!us.some(u => u.decl)) us.push({ path: t.path, line: t.line, col: t.col, len: t.name.length, text: t.signature, preview: [0, 0], decl: true })
  const files = new Set(us.map(u => fileKey(u.path))).size
  useNav.getState().open({
    type: 'rename', title: `Rename ${t.kind === 'enumMember' ? 'enum member' : t.kind}${res.exact ? '' : ' (matched by name — review)'}`,
    name: t.name, occurrences: us, files
  })
}

/** Replace ranges in files: open buffers are edited in place (undoable, left unsaved); others are rewritten on disk. */
export async function applyEdits(edits: { path: string; line: number; col: number; len: number; text: string }[]): Promise<number> {
  const byFile = new Map<string, typeof edits>()
  for (const e of edits) { const k = fileKey(e.path); const a = byFile.get(k) ?? []; a.push(e); byFile.set(k, a) }
  let n = 0
  for (const list of byFile.values()) {
    const path = list[0].path
    const entry = getEntry(path)
    if (entry) {
      entry.model.pushEditOperations([], list.map(e => ({ range: new monaco.Range(e.line, e.col, e.line, e.col + e.len), text: e.text })), () => null)
      n += list.length
      continue
    }
    const f = await window.arw.fs.readFile(path)
    if (f.kind !== 'text') continue
    const lines = f.content.split('\n')
    for (const e of [...list].sort((a, b) => b.line - a.line || b.col - a.col)) {
      const l = lines[e.line - 1]
      if (l === undefined) continue
      lines[e.line - 1] = l.slice(0, e.col - 1) + e.text + l.slice(e.col - 1 + e.len)
      n++
    }
    await window.arw.fs.writeFile(path, lines.join('\n'), f.bom)
  }
  return n
}

// ---------------------------------------------------------------------------------------
// code generation
// ---------------------------------------------------------------------------------------

function snippetController(ed: monaco.editor.ICodeEditor) {
  return ed.getContribution('snippetController2') as unknown as { insert: (template: string, opts?: Record<string, unknown>) => void } | null
}

/** Insert a member snippet on a fresh line below the caret (or on the caret line if it's blank). */
function insertMember(snippet: string) {
  const c = at()
  if (!c) return
  const line = c.pos.lineNumber
  const content = c.model.getLineContent(line)
  if (content.trim() === '') c.ed.setSelection(new monaco.Selection(line, 1, line, content.length + 1))
  else {
    const end = content.length + 1
    c.ed.setSelection(new monaco.Selection(line, end, line, end))
    snippet = '\n' + snippet
  }
  c.ed.focus()
  snippetController(c.ed)?.insert(snippet, { adjustWhitespace: true })
}

function surroundWith() {
  const c = at()
  if (!c) return
  const sel = c.ed.getSelection()!
  const startLine = sel.startLineNumber
  const endLine = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber
  const lines: string[] = []
  for (let l = startLine; l <= endLine; l++) lines.push(c.model.getLineContent(l))
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.length - l.trimStart().length), 1000)
  const body = lines.map(l => '\t' + l.slice(Math.min(indent, l.length - l.trimStart().length))).map(snippetEscape).join('\n')
  const first = c.model.getLineContent(startLine)
  const firstIndent = first.length - first.trimStart().length
  useNav.getState().open({
    type: 'list', title: 'Surround With', anchor: caretAnchor(),
    items: SURROUND_TEMPLATES.map(t => ({
      id: t.key, label: t.name, hint: t.key, icon: 'template',
      onPick: () => {
        c.ed.setSelection(new monaco.Selection(startLine, firstIndent + 1, endLine, c.model.getLineMaxColumn(endLine)))
        c.ed.focus()
        snippetController(c.ed)?.insert(t.body.replace('$SELECTION', body), { adjustWhitespace: true })
      }
    }))
  })
}

async function generate() {
  const c = at()
  if (!c || !isCSharp(c.path)) return
  const doc = docFor(c.model, c.path)
  const encl = [...doc.file.symbols].filter(s => (s.kind === 'class' || s.kind === 'struct' || s.kind === 'record') && s.start <= c.offset && c.offset <= s.end)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]
  if (!encl) return showEditorMessage('Place the caret inside a class to generate code')
  const ownerPath = encl.container ? `${encl.container}.${encl.name}` : encl.name
  const members = doc.file.symbols.filter(s => s.container === ownerPath)
  const fields = members.filter(s => s.kind === 'field' && !s.modifiers.includes('static') && !s.modifiers.includes('const'))
  const items: PopupItem[] = []
  items.push({
    id: 'ctor', label: 'Constructor', icon: 'constructor', detail: fields.length ? `from ${fields.length} field${fields.length > 1 ? 's' : ''}` : undefined,
    onPick: () => {
      const params = fields.map((f, i) => `\${${i + 1}:${f.type} ${f.name.replace(/^_/, '').replace(/^m_/, '')}}`).join(', ')
      const assigns = fields.map(f => { const p = f.name.replace(/^_/, '').replace(/^m_/, ''); return `\t${p === f.name ? 'this.' : ''}${f.name} = ${p};` }).join('\n')
      insertMember(`public ${encl.name}(${params})\n{\n${assigns}$0\n}`)
    }
  })
  const unity = await codeQuery<any>('lens', { path: c.path, src: c.src }).then((l: any[]) => l.some(x => x.name === encl.name && x.unityScript)).catch(() => false)
  if (unity) {
    const have = new Set(members.map(m => m.name))
    items.push({
      id: 'unity', label: 'Unity event functions…', icon: 'unity', onPick: () => {
        useNav.getState().open({
          type: 'list', title: 'Generate Unity event function', filter: true, anchor: caretAnchor(),
          items: UNITY_MESSAGES.filter(m => !have.has(m.name)).map(m => ({
            id: m.name, label: m.name, detail: m.signature, icon: 'unity',
            onPick: () => insertMember(`private ${m.signature}\n{\n\t$0\n}`)
          }))
        })
      }
    })
  }
  const over = await codeQuery<{ member: SymRef; mode: 'override' | 'implement' }[]>('overridable', { path: c.path, src: c.src, offset: c.offset })
  if (over.length) {
    items.push({
      id: 'override', label: 'Overriding / implementing members…', icon: 'method', onPick: () => {
        useNav.getState().open({
          type: 'list', title: 'Generate member', filter: true, anchor: caretAnchor(),
          items: over.map(({ member: m, mode }) => ({
            id: `${m.container}.${m.name}`, label: m.name, detail: `${mode === 'implement' ? 'implement' : 'override'} · ${m.container}`, icon: m.kind,
            onPick: () => insertMember(memberStub(m, mode))
          }))
        })
      }
    })
  }
  useNav.getState().open({ type: 'list', title: 'Generate', anchor: caretAnchor(), items })
}

function memberStub(m: SymRef, mode: 'override' | 'implement'): string {
  const access = m.modifiers.find(x => x === 'public' || x === 'protected' || x === 'internal') ?? 'public'
  const isAbstract = m.modifiers.includes('abstract') || mode === 'implement'
  const head = mode === 'implement' ? 'public' : `${access} override`
  if (m.kind === 'property') {
    return isAbstract
      ? `${head} ${m.type} ${m.name} { get; set; }$0`
      : `${head} ${m.type} ${m.name}\n{\n\tget => base.${m.name};\n\tset => base.${m.name} = value;$0\n}`
  }
  if (m.kind === 'event') return `public event ${m.type} ${m.name};$0`
  const params = (m.params ?? []).map(p => `${p.modifier ? p.modifier + ' ' : ''}${p.type} ${p.name}`).join(', ')
  const args = (m.params ?? []).map(p => `${p.modifier === 'out' || p.modifier === 'ref' ? p.modifier + ' ' : ''}${p.name}`).join(', ')
  const ret = m.type ?? 'void'
  const body = isAbstract ? 'throw new System.NotImplementedException();' : `${ret === 'void' ? '' : 'return '}base.${m.name}(${args});`
  return `${head} ${ret} ${m.name}(${params})\n{\n\t${body}$0\n}`
}

async function copyReference() {
  const c = at()
  if (!c) return
  let ref = `${rel(c.path)}:${c.pos.lineNumber}`
  if (isCSharp(c.path)) {
    const res = await codeQuery<Resolution>('resolve', { path: c.path, src: c.src, offset: c.offset })
    if (res.kind === 'symbols') {
      const t = res.targets[0]
      ref = [t.namespace, t.container, t.name].filter(Boolean).join('.')
    }
  }
  window.arw.clipboardWrite(ref)
  showEditorMessage(`Copied: ${ref}`)
}

// ---------------------------------------------------------------------------------------
// small editor commands
// ---------------------------------------------------------------------------------------

function moveToVisibleEdge(edge: 'top' | 'bottom') {
  const ed = getEditor()
  const r = ed?.getVisibleRanges()[0]
  if (!ed || !r) return
  ed.setPosition({ lineNumber: edge === 'top' ? r.startLineNumber : r.endLineNumber, column: ed.getPosition()?.column ?? 1 })
}

function toggleCase() {
  const ed = getEditor()
  const model = ed?.getModel(), sels = ed?.getSelections()
  if (!ed || !model || !sels) return
  // Rider: all-lowercase selection -> UPPER, otherwise -> lower. Empty selection = word at caret.
  const ranges = sels.map(s => {
    if (!s.isEmpty()) return s
    const w = model.getWordAtPosition(s.getPosition())
    return w ? new monaco.Range(s.positionLineNumber, w.startColumn, s.positionLineNumber, w.endColumn) : s
  })
  const text = ranges.map(r => model.getValueInRange(r)).join('')
  const upper = text === text.toLowerCase()
  ed.executeEdits('toggleCase', ranges.map(r => ({ range: r, text: upper ? model.getValueInRange(r).toUpperCase() : model.getValueInRange(r).toLowerCase() })))
}

function toggleBreakpoint() {
  const c = at()
  if (c && isCSharp(c.path)) useIde.getState().toggleBreakpoint(c.path, c.pos.lineNumber)
}

function toggleBookmark() {
  const c = at()
  if (c) useIde.getState().toggleBookmark(c.path, c.pos.lineNumber)
}

// ---------------------------------------------------------------------------------------
// command table
// ---------------------------------------------------------------------------------------

const COMMANDS: Record<string, () => unknown> = {
  'arw.gotoDeclaration': gotoDeclaration,
  'arw.gotoImplementation': gotoImplementation,
  'arw.gotoSuper': gotoSuper,
  'arw.gotoTypeDeclaration': gotoTypeDeclaration,
  'arw.findUsages': findUsages,
  'arw.showUsages': showUsages,
  'arw.rename': rename,
  'arw.nextMethod': () => jumpMember(1),
  'arw.prevMethod': () => jumpMember(-1),
  'arw.fileStructure': fileStructure,
  'arw.recentFiles': () => recentFiles(false),
  'arw.switcher': () => recentFiles(true),
  'arw.back': () => { goBack(); return true },
  'arw.forward': () => { goForward(); return true },
  'arw.searchEverywhere': () => useNav.getState().open({ type: 'search', tab: 'all' }),
  'arw.gotoFile': () => useNav.getState().open({ type: 'search', tab: 'files' }),
  'arw.gotoClass': () => useNav.getState().open({ type: 'search', tab: 'classes' }),
  'arw.gotoSymbol': () => useNav.getState().open({ type: 'search', tab: 'symbols' }),
  'arw.findAction': () => useNav.getState().open({ type: 'search', tab: 'actions' }),
  'arw.findInFiles': () => openFindInFiles(),
  'arw.replaceInFiles': () => openFindInFiles(undefined, true),
  'arw.toggleBookmark': toggleBookmark,
  'arw.showBookmarks': showBookmarks,
  'arw.surroundWith': surroundWith,
  'arw.generate': generate,
  'arw.liveTemplates': () => runCommand('editor.action.triggerSuggest'),
  'arw.copyReference': copyReference,
  'arw.toggleInlayHints': () => { const p = useIde.getState().editorPrefs; useIde.getState().setEditorPref('inlayHints', !p.inlayHints) },
  'arw.toggleCodeVision': () => { const p = useIde.getState().editorPrefs; useIde.getState().setEditorPref('codeVision', !p.codeVision) },
  'arw.settings': () => useNav.getState().open({ type: 'settings', tab: 'editor' }),
  'arw.keymap': () => useNav.getState().open({ type: 'settings', tab: 'keymap' }),
  'arw.pageTop': () => moveToVisibleEdge('top'),
  'arw.pageBottom': () => moveToVisibleEdge('bottom'),
  'arw.toggleCase': toggleCase,
  'arw.toggleBreakpoint': toggleBreakpoint,
  'arw.reopenClosedTab': () => {
    const st = useNav.getState()
    const open = useIde.getState().tabs[ideCtx.projectId]?.paths ?? []
    const p = st.closed.find(x => !open.some(o => fileKey(o) === fileKey(x)))
    if (!p) return false
    useNav.setState({ closed: st.closed.filter(x => x !== p) })
    useIde.getState().openFile(ideCtx.projectId, p)
  },
  'arw.selectInTree': () => {
    const p = getActivePath()
    if (!p) return false
    if (!useIde.getState().treeOpen) useIde.getState().toggleTree()
    useNav.setState({ selectInTree: { path: p, nonce: Math.random() } })
  },
  // ---- window ----
  'arw.closeTab': () => {
    const t = useIde.getState().tabs[ideCtx.projectId]
    if (!t?.active) return false
    useIde.getState().requestCloseTab(ideCtx.projectId, t.active)
  },
  'arw.saveAll': () => { void saveAll() },
  'arw.toggleTree': () => useIde.getState().toggleTree(),
  'arw.toggleFind': () => {
    const st = useNav.getState()
    if (!st.find) { openFindInFiles(''); return }
    if (st.findOpen && st.bottomTab !== 'find' && useIde.getState().debugOpen) { useNav.setState({ bottomTab: 'find' }); return }
    st.setFindOpen(!st.findOpen)
  },
  'arw.toggleDebug': () => {
    const ide = useIde.getState()
    if (ide.debugOpen && useNav.getState().findOpen && useNav.getState().bottomTab !== 'debug') { useNav.setState({ bottomTab: 'debug' }); return }
    ide.setDebugOpen(!ide.debugOpen)
    if (!ide.debugOpen) useNav.setState({ bottomTab: 'debug' })
  },
  'arw.hideAll': () => {
    const ide = useIde.getState(), nav = useNav.getState()
    const anyOpen = ide.treeOpen || ide.debugOpen || nav.findOpen
    if (ide.treeOpen === anyOpen) ide.toggleTree()
    ide.setDebugOpen(!anyOpen)
    nav.setFindOpen(!anyOpen && !!nav.find)
  },
  'arw.debug': () => {
    const dbg = useDebug.getState()
    if (!ideCtx.isUnity || dbg.phase !== 'idle') return false
    useIde.getState().setDebugOpen(true)
    useNav.setState({ bottomTab: 'debug' })
    void dbg.attach(ideCtx.projectId, ideCtx.root)
  },
  'arw.resume': () => { const d = useDebug.getState(); if (d.phase === 'idle') return false; d.resume() },
  'arw.stepOver': () => { const d = useDebug.getState(); if (d.phase === 'idle') return false; d.stepOver() },
  'arw.stepInto': () => { const d = useDebug.getState(); if (d.phase === 'idle') return false; d.stepInto() },
  'arw.stepOut': () => { const d = useDebug.getState(); if (d.phase === 'idle') return false; d.stepOut() },
  'arw.stop': () => { const d = useDebug.getState(); if (d.phase === 'idle') return false; d.stop() }
}

/** Every action for Find Action / the keymap editor: id, name, shortcut. */
export const allActions = () => ACTIONS

// ---------------------------------------------------------------------------------------
// Code Vision clicks
// ---------------------------------------------------------------------------------------

let lensRegistered = false
export function registerLensCommands() {
  if (lensRegistered) return
  lensRegistered = true
  monaco.editor.registerCommand('arw.lens.usages', (_a, path: string, line: number, col: number, name: string) => {
    void showUsagesPopup({ path, line, col, name })
  })
  monaco.editor.registerCommand('arw.lens.impls', async (_a, path: string, line: number, col: number) => {
    const model = getEntry(path)?.model
    if (!model) return
    const res = await codeQuery<Resolution>('resolve', { path, src: model.getValue(), offset: model.getOffsetAt({ lineNumber: line, column: col }) })
    if (res.kind !== 'symbols') return
    const impls = await codeQuery<SymRef[]>('implementations', { target: res.targets[0] })
    if (impls.length === 1) navigateTo(locOf(impls[0]))
    else if (impls.length) choose(`Implementations of ${res.targets[0].name}`, impls)
  })
  monaco.editor.registerCommand('arw.lens.unity', (_a, name: string) => {
    const msg = UNITY_MESSAGES.find(m => m.name === name)
    window.arw.openExternal(msg ? `https://docs.unity3d.com/ScriptReference/MonoBehaviour.${name}.html` : 'https://docs.unity3d.com/ScriptReference/MonoBehaviour.html')
  })
}

/** Gutter icon click (overrides ↑ / implemented ↓ / Unity). */
export async function gutterAction(path: string, line: number, kind: 'super' | 'impl') {
  const model = getEntry(path)?.model
  const ed = getEditor()
  if (!model || !ed) return
  const doc = docFor(model, path)
  const s = doc.file.symbols.find(x => x.line === line)
  if (!s) return
  ed.setPosition({ lineNumber: line, column: s.col })
  if (kind === 'super') await gotoSuper()
  else await gotoImplementation()
}

export { refreshInsight }
