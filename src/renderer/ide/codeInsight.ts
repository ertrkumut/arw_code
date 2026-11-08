import { monaco, CSHARP } from './monaco'
import { docToMarkdown, isTypeKind, type CsKind } from '@shared/csharp'
import type { Resolution, CompletionEntry, SignatureInfo, InlayHint, LensInfo } from '@shared/csharpAnalysis'
import { UNITY_MESSAGE_MAP, unityDocsUrl } from '@shared/unityApi'
import { pathOfModel } from './models'
import { codeQuery, docFor, ideCtx } from './context'
import { relativeTo } from './paths'
import { useIde } from '../store/ideStore'
import { useNav } from '../store/navStore'
import { LIVE_TEMPLATES } from './templates'

/**
 * Monaco language features for C#, backed by the project index in main:
 * hover docs (Quick Documentation), completion, parameter info, parameter-name inlay
 * hints, Code Vision lenses, "Import namespace" quick fixes and the document outline.
 */

const inlayChanged = new monaco.Emitter<void>()
const lensChanged = new monaco.Emitter<monaco.languages.CodeLensProvider>()
const lensListeners = new Set<() => void>()

/** Re-ask hints / lenses (index changed, setting toggled). */
export function refreshInsight() {
  lensCache.clear()
  inlayChanged.fire()
  lensChanged.fire(lensProvider)
  lensListeners.forEach(f => f())
}
export function onLensRefresh(f: () => void) { lensListeners.add(f); return () => { lensListeners.delete(f) } }

const req = (model: monaco.editor.ITextModel, position?: monaco.IPosition) => {
  const path = pathOfModel(model)
  if (!path || !ideCtx.root) return null
  return { path, src: model.getValue(), offset: position ? model.getOffsetAt(position) : 0 }
}

export const KIND_LABEL: Record<string, string> = {
  class: 'class', struct: 'struct', interface: 'interface', enum: 'enum', record: 'record', delegate: 'delegate',
  method: 'method', constructor: 'constructor', property: 'property', indexer: 'indexer', field: 'field',
  const: 'constant', event: 'event', enumMember: 'enum member', namespace: 'namespace', local: 'local', keyword: 'keyword',
  unityMessage: 'Unity event'
}

const CK = monaco.languages.CompletionItemKind
const COMPLETION_KIND: Record<string, monaco.languages.CompletionItemKind> = {
  class: CK.Class, struct: CK.Struct, interface: CK.Interface, enum: CK.Enum, record: CK.Class, delegate: CK.Function,
  method: CK.Method, constructor: CK.Constructor, property: CK.Property, indexer: CK.Property, field: CK.Field,
  const: CK.Constant, event: CK.Event, enumMember: CK.EnumMember, local: CK.Variable, keyword: CK.Keyword,
  unityMessage: CK.Method, namespace: CK.Module
}

const SK = monaco.languages.SymbolKind
export const SYMBOL_KIND: Record<CsKind, monaco.languages.SymbolKind> = {
  namespace: SK.Namespace, class: SK.Class, struct: SK.Struct, interface: SK.Interface, enum: SK.Enum, record: SK.Class,
  delegate: SK.Function, method: SK.Method, constructor: SK.Constructor, property: SK.Property, indexer: SK.Property,
  field: SK.Field, const: SK.Constant, event: SK.Event, enumMember: SK.EnumMember
}

function hoverFor(r: Resolution): monaco.IMarkdownString[] | null {
  const fence = (s: string) => ({ value: '```csharp\n' + s + '\n```' })
  if (r.kind === 'local') {
    return [fence(`(${r.isParam ? 'parameter' : 'local variable'}) ${r.type ?? 'var'} ${r.word}`)]
  }
  if (r.kind === 'symbols') {
    const t = r.targets[0]
    const out: monaco.IMarkdownString[] = [fence(t.signature || t.name)]
    const where = [
      KIND_LABEL[t.kind] ?? t.kind,
      t.container ? `in \`${t.container}\`` : t.namespace ? `in \`${t.namespace}\`` : '',
      `· ${relativeTo(ideCtx.root, t.path)}:${t.line}`
    ].filter(Boolean).join(' ')
    out.push({ value: `_${where}_` })
    const doc = docToMarkdown(t.doc)
    if (doc) out.push({ value: doc })
    const msg = t.kind === 'method' ? UNITY_MESSAGE_MAP.get(t.name) : undefined
    if (msg && !doc) out.push({ value: `**Unity event function** — ${msg.doc}` })
    if (r.targets.length > 1) out.push({ value: `_+${r.targets.length - 1} more candidate${r.targets.length > 2 ? 's' : ''} — Ctrl+Click to choose_` })
    return out
  }
  if (r.kind === 'external') {
    const name = r.typeName && r.typeName !== r.word ? `${r.typeName}.${r.word}` : r.word
    const msg = UNITY_MESSAGE_MAP.get(r.word)
    return [
      fence(name),
      { value: msg ? `**Unity event function** — ${msg.doc}` : '_Declared outside the project (Unity / .NET)_' },
      { value: `[Search Unity docs for ${r.typeName ?? r.word}](${unityDocsUrl(name)})`, isTrusted: true }
    ]
  }
  return null
}

let lensProvider: monaco.languages.CodeLensProvider
const lensCache = new Map<monaco.editor.ITextModel, { v: number; p: Promise<LensInfo[]> }>()

/** Code Vision data for a buffer (shared by the lens provider and the gutter icons). */
export function lensFor(model: monaco.editor.ITextModel): Promise<LensInfo[]> {
  const v = model.getAlternativeVersionId()
  const c = lensCache.get(model)
  if (c && c.v === v) return c.p
  const r = req(model)
  const p = r ? codeQuery<LensInfo[]>('lens', { path: r.path, src: r.src }).catch(() => []) : Promise.resolve([])
  lensCache.set(model, { v, p })
  return p
}

let registered = false
export function registerCodeInsight() {
  if (registered) return
  registered = true
  const L = CSHARP

  // External links in hovers (Unity docs) open in the browser, not in this window.
  ;(monaco.editor as any).registerLinkOpener?.({
    open(uri: monaco.Uri) {
      const s = uri.toString(true)
      if (/^https?:/i.test(s)) { window.arw.openExternal(s); return true }
      return false
    }
  })

  monaco.languages.registerHoverProvider(L, {
    provideHover: async (model, position) => {
      const r = req(model, position)
      if (!r) return null
      try {
        const res = await codeQuery<Resolution>('resolve', r)
        const contents = hoverFor(res)
        if (!contents || res.kind === 'none') return null
        const a = model.getPositionAt(res.range[0]), b = model.getPositionAt(res.range[1])
        return { range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column), contents }
      } catch { return null }
    }
  })

  monaco.languages.registerCompletionItemProvider(L, {
    triggerCharacters: ['.'],
    provideCompletionItems: async (model, position) => {
      const r = req(model, position)
      if (!r) return { suggestions: [] }
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
      let items: CompletionEntry[] = []
      try { items = await codeQuery<CompletionEntry[]>('complete', r) } catch { /* index not ready */ }
      const before = model.getValueInRange(new monaco.Range(position.lineNumber, 1, position.lineNumber, word.startColumn)).trimEnd()
      const afterDot = before.endsWith('.')
      const suggestions: monaco.languages.CompletionItem[] = items.map(i => ({
        label: { label: i.label, description: i.kind === 'keyword' ? undefined : (KIND_LABEL[i.kind] ?? i.kind) },
        kind: COMPLETION_KIND[i.kind] ?? CK.Text,
        detail: i.detail,
        documentation: i.doc ? { value: docToMarkdown(i.doc) } : undefined,
        insertText: i.insert ?? i.label,
        insertTextRules: i.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        sortText: `${i.sort ?? '5'}${i.label}`,
        range
      }))
      if (!afterDot) {
        for (const t of LIVE_TEMPLATES) {
          suggestions.push({
            label: { label: t.key, description: 'live template' }, kind: CK.Snippet, detail: t.description,
            documentation: { value: '```csharp\n' + t.body.replace(/\$\{\d+:?([^}]*)\}|\$\d/g, '$1') + '\n```' },
            insertText: t.body, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText: `6${t.key}`, range
          })
        }
      }
      return { suggestions }
    }
  })

  monaco.languages.registerSignatureHelpProvider(L, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp: async (model, position) => {
      const r = req(model, position)
      if (!r) return null
      let s: SignatureInfo | null = null
      try { s = await codeQuery<SignatureInfo | null>('signature', r) } catch { return null }
      if (!s) return null
      return {
        value: {
          signatures: s.signatures.map(x => ({ label: x.label, parameters: x.params.map(p => ({ label: p })), documentation: x.doc ? { value: docToMarkdown(x.doc) } : undefined })),
          activeSignature: s.activeSignature,
          activeParameter: s.activeParameter
        },
        dispose() {}
      }
    }
  })

  monaco.languages.registerInlayHintsProvider(L, {
    onDidChangeInlayHints: inlayChanged.event,
    provideInlayHints: async (model, range) => {
      const empty = { hints: [], dispose() {} }
      if (!useIde.getState().editorPrefs.inlayHints) return empty
      const r = req(model)
      if (!r) return empty
      let hints: InlayHint[] = []
      try { hints = await codeQuery<InlayHint[]>('inlay', { path: r.path, src: r.src, from: range.startLineNumber, to: range.endLineNumber }) } catch { return empty }
      return {
        hints: hints.map(h => ({ position: { lineNumber: h.line, column: h.col }, label: h.label, kind: monaco.languages.InlayHintKind.Parameter, paddingRight: true })),
        dispose() {}
      }
    }
  })

  lensProvider = {
    onDidChange: lensChanged.event,
    provideCodeLenses: async (model) => {
      const empty = { lenses: [], dispose() {} }
      if (!useIde.getState().editorPrefs.codeVision) return empty
      const path = pathOfModel(model)
      if (!path) return empty
      const infos = await lensFor(model)
      const lenses: monaco.languages.CodeLens[] = []
      for (const i of infos) {
        if (i.kind === 'field' || i.kind === 'const' || i.kind === 'enumMember' || i.kind === 'constructor') continue
        const range = { startLineNumber: i.line, startColumn: 1, endLineNumber: i.line, endColumn: 1 }
        const args = [path, i.line, i.col, i.name]
        if (i.unityScript) lenses.push({ range, command: { id: 'arw.lens.unity', title: '◆ Unity script', arguments: [i.name] } })
        if (i.unityEvent) lenses.push({ range, command: { id: 'arw.lens.unity', title: '◆ Unity event function', arguments: [i.name] } })
        lenses.push({ range, command: { id: 'arw.lens.usages', title: i.usages ? `${i.usages} usage${i.usages === 1 ? '' : 's'}` : 'no usages', arguments: args } })
        if (i.implementations) {
          const word = isTypeKind(i.kind)
            ? (i.kind === 'interface' ? 'implementation' : 'inheritor')
            : 'implementation'
          lenses.push({ range, command: { id: 'arw.lens.impls', title: `${i.implementations} ${word}${i.implementations === 1 ? '' : 's'}`, arguments: args } })
        }
      }
      return { lenses, dispose() {} }
    }
  }
  monaco.languages.registerCodeLensProvider(L, lensProvider)

  monaco.languages.registerCodeActionProvider(L, {
    provideCodeActions: async (model, range) => {
      const empty = { actions: [], dispose() {} }
      const word = model.getWordAtPosition(range.getStartPosition())
      if (!word || !/^[A-Z]/.test(word.word)) return empty
      let nss: string[] = []
      try { nss = await codeQuery<string[]>('namespacesFor', { name: word.word }) } catch { return empty }
      const text = model.getValue()
      const usings = new Set([...text.matchAll(/^\s*using\s+([\w.]+)\s*;/gm)].map(m => m[1]))
      const fileNs = [...text.matchAll(/^\s*namespace\s+([\w.]+)/gm)].map(m => m[1])
      const missing = nss.filter(ns => !usings.has(ns) && !fileNs.some(f => f === ns || f.startsWith(ns + '.')))
      if (!missing.length || nss.some(ns => usings.has(ns))) return empty
      // after the last using, else at the top
      let line = 1
      model.getLinesContent().forEach((l, i) => { if (/^\s*using\s+[\w.]+\s*;/.test(l)) line = i + 2 })
      return {
        actions: missing.map(ns => ({
          title: `Import '${ns}'`,
          kind: 'quickfix',
          isPreferred: missing.length === 1,
          edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: new monaco.Range(line, 1, line, 1), text: `using ${ns};\n` } }] }
        })),
        dispose() {}
      }
    }
  }, { providedCodeActionKinds: ['quickfix'] })

  monaco.languages.registerDocumentSymbolProvider(L, {
    provideDocumentSymbols: (model) => {
      const path = pathOfModel(model)
      if (!path) return []
      const doc = docFor(model, path)
      const roots: monaco.languages.DocumentSymbol[] = []
      const stack: { end: number; sym: monaco.languages.DocumentSymbol }[] = []
      const syms = [...doc.file.symbols].sort((a, b) => a.start - b.start || b.end - a.end)
      for (const s of syms) {
        const a = model.getPositionAt(s.start), b = model.getPositionAt(s.end)
        const ds: monaco.languages.DocumentSymbol = {
          name: s.name, detail: s.signature, kind: SYMBOL_KIND[s.kind], tags: [],
          range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column),
          selectionRange: new monaco.Range(s.line, s.col, s.line, s.col + s.name.length),
          children: []
        }
        while (stack.length && stack[stack.length - 1].end <= s.start) stack.pop()
        if (stack.length) stack[stack.length - 1].sym.children!.push(ds)
        else roots.push(ds)
        stack.push({ end: s.end, sym: ds })
      }
      return roots
    }
  })

  // Index progress → status bar; index changes → fresh hints and lenses.
  let t: number | undefined
  window.arw.code.onEvent(({ root, ev, status }) => {
    if (root.toLowerCase() !== ideCtx.root.toLowerCase()) return
    useNav.setState({ index: status })
    if (ev === 'changed') { clearTimeout(t); t = window.setTimeout(refreshInsight, 300) }
  })
  void codeQuery('status').then((s: any) => useNav.setState({ index: s })).catch(() => {})

  // Settings toggles repaint immediately.
  useIde.subscribe((s, p) => {
    if (s.editorPrefs.inlayHints !== p.editorPrefs.inlayHints || s.editorPrefs.codeVision !== p.editorPrefs.codeVision) refreshInsight()
  })
}
