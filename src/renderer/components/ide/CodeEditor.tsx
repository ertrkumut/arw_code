import React, { useEffect, useRef, useState } from 'react'
import { monaco, ensureMonaco, monacoThemeName, CSHARP } from '../../ide/monaco'
import { openModel, getEntry } from '../../ide/models'
import { installKeymap } from '../../ide/keymap'
import { setActiveEditor, setActivePath, docFor, isCSharp } from '../../ide/context'
import { registerCodeInsight, lensFor, onLensRefresh } from '../../ide/codeInsight'
import { runCommand, registerLensCommands, gutterAction } from '../../ide/commands'
import { installMouseNavigation } from '../../ide/mouseNav'
import { useNav } from '../../store/navStore'
import type { LensInfo } from '@shared/csharpAnalysis'
import type { EditorPrefs } from '@shared/editorPrefs'
import { fileKey, extOf, expressionAt } from '../../ide/paths'
import { useIde } from '../../store/ideStore'
import { useDebug, executionPoint } from '../../store/debugStore'
import { getTheme } from '../../themes'
import { ImageViewer } from './ImageViewer'
import { AgentDiffView } from '../../ide/agentDiffView'
import { acceptAll, rejectAll } from '../../ide/agentReview'
import { useEdits } from '../../store/editsStore'

const canBreak = (path: string) => extOf(path) === 'cs'

// Saved scroll/cursor per file, so switching tabs returns you where you were.
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

let hoverRegistered = false
function registerDebugHover() {
  if (hoverRegistered) return
  hoverRegistered = true
  // While paused, hovering an identifier evaluates it (and its `a.b.` prefix) in the current frame.
  monaco.languages.registerHoverProvider(CSHARP, {
    provideHover: async (model, position) => {
      if (useDebug.getState().phase !== 'paused') return null
      const word = model.getWordAtPosition(position)
      if (!word) return null
      const expr = expressionAt(model.getLineContent(position.lineNumber), word.startColumn, word.endColumn)
      if (!expr) return null
      const r = await useDebug.getState().evaluate(expr, 'hover')
      if (!r) return null
      const type = r.type ? ` {${r.type}}` : ''
      return {
        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
        contents: [{ value: '```text\n' + `${expr}${type} = ${r.result}` + '\n```' }]
      }
    }
  })
}

/** The single Monaco instance; swaps models as tabs change. */
export function CodeEditor({ path }: { path: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const pathRef = useRef<string | null>(null)
  const bpDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const execDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const hoverDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const flashDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const bookmarkDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const gutterDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const lensRef = useRef<LensInfo[]>([])
  const diffView = useRef<AgentDiffView | null>(null)
  const themeId = useIde(s => s.themeId)
  // Claude's changes in this file (for the review bar).
  const [review, setReview] = useState<{ count: number; index: number }>({ count: 0, index: 0 })
  const created = useEdits(s => (path ? !!s.edits[fileKey(path)]?.created : false))

  // ---- create once ----
  useEffect(() => {
    ensureMonaco()
    registerDebugHover()
    registerCodeInsight()
    registerLensCommands()
    const prefs = useIde.getState().editorPrefs
    const ed = monaco.editor.create(hostRef.current!, {
      model: null,
      theme: monacoThemeName(getTheme(useIde.getState().themeId)),
      automaticLayout: true,
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      ...prefOptions(prefs),
      fontLigatures: true,
      glyphMargin: true, lineNumbersMinChars: 4,
      folding: true, showFoldingControls: 'mouseover',
      renderLineHighlight: 'all', cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
      smoothScrolling: true, scrollBeyondLastLine: false, mouseWheelZoom: true,
      guides: { indentation: true, bracketPairs: false, highlightActiveIndentation: true },
      bracketPairColorization: { enabled: false },
      inlayHints: { enabled: 'on', fontSize: 11.5, padding: true },
      codeLens: true, codeLensFontSize: 11.5,
      suggest: { showWords: false, preview: true },
      parameterHints: { enabled: true, cycle: true },
      quickSuggestions: { other: true, comments: false, strings: false },
      hover: { delay: 450 },
      padding: { top: 6 },
      scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12, useShadows: false },
      fixedOverflowWidgets: true
    })
    edRef.current = ed
    bpDecos.current = ed.createDecorationsCollection()
    execDecos.current = ed.createDecorationsCollection()
    hoverDecos.current = ed.createDecorationsCollection()
    flashDecos.current = ed.createDecorationsCollection()
    bookmarkDecos.current = ed.createDecorationsCollection()
    gutterDecos.current = ed.createDecorationsCollection()
    const dv = new AgentDiffView(ed, (h) => setReview({ count: h.length, index: Math.min(dv.currentIndex(), Math.max(0, h.length - 1)) }))
    diffView.current = dv
    ed.onDidChangeCursorPosition(() => {
      if (dv.hunks.length) setReview(r => ({ ...r, index: dv.currentIndex() }))
    })

    // Keymap (ide/keymap.ts -> ide/commands.ts), Ctrl+Click navigation, caret info for the status bar.
    installKeymap(runCommand)
    setActiveEditor(ed)
    const mouseNav = installMouseNavigation(ed)
    let caretTimer: number | undefined
    const updateCaret = () => {
      clearTimeout(caretTimer)
      caretTimer = window.setTimeout(() => {
        const model = ed.getModel(), pos = ed.getPosition(), p = pathRef.current
        if (!model || !pos || !p) { useNav.setState({ caret: null }); return }
        const sel = ed.getSelection()
        const selection = sel && !sel.isEmpty() ? model.getValueLengthInRange(sel) : 0
        let symbols: { name: string; kind: string; line: number; col: number }[] = []
        if (isCSharp(p)) {
          const doc = docFor(model, p)
          const off = model.getOffsetAt(pos)
          const chain = doc.file.symbols.filter(x => x.kind !== 'enumMember' && x.start <= off && off <= x.end).sort((a, b) => (b.end - b.start) - (a.end - a.start))
          symbols = chain.map(x => ({ name: x.name, kind: x.kind, line: x.line, col: x.col }))
          const ns = chain[0]?.namespace
          if (ns) symbols.unshift({ name: ns, kind: 'namespace', line: 0, col: 0 })
        }
        useNav.setState({ caret: { line: pos.lineNumber, col: pos.column, selection, symbols } })
      }, 80)
    }
    ed.onDidChangeCursorSelection(updateCaret)
    ed.onDidChangeModel(updateCaret)

    // Click in the gutter (glyph margin or line numbers) toggles a breakpoint, like Rider.
    const T = monaco.editor.MouseTargetType
    ed.onMouseDown((e) => {
      const p = pathRef.current
      if (!p || e.event.rightButton) return
      // Unity / override / implementation icons next to the line numbers
      if (e.target.type === T.GUTTER_LINE_DECORATIONS && e.target.position) {
        const ln = e.target.position.lineNumber
        const info = lensRef.current.find(l => l.line === ln)
        if (!info) return
        e.event.preventDefault()
        if (info.overrides) void gutterAction(p, ln, 'super')
        else if (info.implementations) void gutterAction(p, ln, 'impl')
        else if (info.unityEvent || info.unityScript) runCommand('editor.action.showHover')
        return
      }
      if (!canBreak(p)) return
      if (e.target.type !== T.GUTTER_GLYPH_MARGIN && e.target.type !== T.GUTTER_LINE_NUMBERS) return
      const line = e.target.position?.lineNumber
      if (!line) return
      e.event.preventDefault()
      useIde.getState().toggleBreakpoint(p, line)
    })
    // Faint dot where a breakpoint would go.
    ed.onMouseMove((e) => {
      const p = pathRef.current
      const onGutter = e.target.type === T.GUTTER_GLYPH_MARGIN || e.target.type === T.GUTTER_LINE_NUMBERS
      const line = e.target.position?.lineNumber
      const has = p && line ? (useIde.getState().breakpoints[fileKey(p)]?.lines ?? []).includes(line) : false
      hoverDecos.current!.set(p && canBreak(p) && onGutter && line && !has
        ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'arw-bp-ghost' } }]
        : [])
    })
    ed.onMouseLeave(() => hoverDecos.current!.clear())

    // Breakpoint decorations ride along with edits; write the moved lines back to the store.
    let syncTimer: number | undefined, diffTimer: number | undefined
    ed.onDidChangeModelContent(() => {
      clearTimeout(diffTimer)
      diffTimer = window.setTimeout(() => dv.paint(pathRef.current), 150)
      clearTimeout(syncTimer)
      syncTimer = window.setTimeout(() => {
        const p = pathRef.current
        const model = ed.getModel()
        if (!p || !model || !bpDecos.current) return
        const lines = bpDecos.current.getRanges().map(r => r.startLineNumber)
        useIde.getState().setBreakpointLines(p, lines)
        if (bookmarkDecos.current) useIde.getState().setBookmarkLines(p, bookmarkDecos.current.getRanges().map(r => r.startLineNumber))
      }, 250)
      scheduleGutter()
    })
    let gutterTimer: number | undefined
    const scheduleGutter = () => { clearTimeout(gutterTimer); gutterTimer = window.setTimeout(paintGutter, 600) }
    const offLens = onLensRefresh(scheduleGutter)

    return () => {
      clearTimeout(syncTimer)
      clearTimeout(diffTimer)
      clearTimeout(gutterTimer)
      clearTimeout(caretTimer)
      offLens()
      mouseNav.dispose()
      dv.dispose()
      diffView.current = null
      if (pathRef.current) viewStates.set(fileKey(pathRef.current), ed.saveViewState())
      setActiveEditor(null)
      ed.dispose()
      edRef.current = null
    }
  }, [])

  // ---- theme ----
  useEffect(() => { monaco.editor.setTheme(monacoThemeName(getTheme(themeId))) }, [themeId])

  // ---- Settings > Editor ----
  const prefs = useIde(s => s.editorPrefs)
  useEffect(() => {
    edRef.current?.updateOptions(prefOptions(prefs))
    paintGutter()
  }, [prefs])

  // ---- decorations ----
  const paintBreakpoints = () => {
    const p = pathRef.current, ed = edRef.current
    if (!ed || !bpDecos.current) return
    if (!p || !ed.getModel()) { bpDecos.current.clear(); return }
    const k = fileKey(p)
    const lines = useIde.getState().breakpoints[k]?.lines ?? []
    const dbg = useDebug.getState()
    const verified = dbg.verified[k]
    const attached = dbg.phase !== 'idle' && dbg.canBreakNow
    const lineCount = ed.getModel()!.getLineCount()
    bpDecos.current.set(lines.filter(l => l <= lineCount).map(l => {
      // Mono binds a breakpoint when Unity loads that code (often only in Play mode),
      // so "not bound yet" is normal; a ✓ marks the ones already bound, like Rider.
      const bound = attached && verified?.[l] === true
      return {
        range: new monaco.Range(l, 1, l, 1),
        options: {
          isWholeLine: true,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          glyphMarginClassName: bound ? 'arw-bp arw-bp-bound' : 'arw-bp',
          glyphMarginHoverMessage: { value: !attached ? 'Line breakpoint · click to remove'
            : bound ? 'Breakpoint bound · will pause here' : 'Breakpoint set · binds when Unity loads this code (e.g. in Play mode)' },
          className: 'arw-bp-line',
          overviewRuler: { color: '#DB5C5C', position: monaco.editor.OverviewRulerLane.Left }
        }
      }
    }))
  }
  const paintExecution = () => {
    const p = pathRef.current, ed = edRef.current
    if (!ed || !execDecos.current) return
    const ep = executionPoint(useDebug.getState())
    if (!p || !ep || ep.key !== fileKey(p)) { execDecos.current.clear(); return }
    execDecos.current.set([{
      range: new monaco.Range(ep.line, 1, ep.line, 1),
      options: {
        isWholeLine: true,
        className: 'arw-exec-line',
        glyphMarginClassName: ep.top ? 'arw-exec-arrow' : 'arw-exec-arrow arw-exec-frame',
        overviewRuler: { color: '#E0B050', position: monaco.editor.OverviewRulerLane.Full }
      }
    }])
  }

  const paintBookmarks = () => {
    const p = pathRef.current, ed = edRef.current
    if (!ed || !bookmarkDecos.current) return
    if (!p || !ed.getModel()) { bookmarkDecos.current.clear(); return }
    const lines = useIde.getState().bookmarks[fileKey(p)]?.lines ?? []
    const lineCount = ed.getModel()!.getLineCount()
    bookmarkDecos.current.set(lines.filter(l => l <= lineCount).map(l => ({
      range: new monaco.Range(l, 1, l, 1),
      options: {
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        glyphMarginClassName: 'arw-bookmark',
        glyphMargin: { position: monaco.editor.GlyphMarginLane.Right },
        glyphMarginHoverMessage: { value: 'Bookmark - F11 to remove, Shift+F11 to list' },
        overviewRuler: { color: '#6A9FD8', position: monaco.editor.OverviewRulerLane.Center }
      }
    })))
  }
  /** Unity / override / implementation icons from the Code Vision data. */
  function paintGutter() {
    const p = pathRef.current, ed = edRef.current, model = ed?.getModel()
    if (!ed || !gutterDecos.current) return
    if (!p || !model || !isCSharp(p) || !useIde.getState().editorPrefs.unityGutter) { gutterDecos.current.clear(); lensRef.current = []; return }
    void lensFor(model).then(infos => {
      if (pathRef.current !== p || ed.getModel() !== model) return
      lensRef.current = infos
      const decos: monaco.editor.IModelDeltaDecoration[] = []
      for (const i of infos) {
        let cls = '', tip = ''
        if (i.unityEvent) { cls = 'arw-gut-unity'; tip = 'Unity event function - called by the engine' }
        else if (i.unityScript) { cls = 'arw-gut-unity'; tip = 'Unity script (MonoBehaviour / ScriptableObject)' }
        if (i.overrides) { cls = cls ? cls + ' arw-gut-up' : 'arw-gut-up'; tip = (tip ? tip + ' | ' : '') + 'Overrides / implements a base member - click to go to it' }
        else if (i.implementations) { cls = cls ? cls + ' arw-gut-down' : 'arw-gut-down'; tip = (tip ? tip + ' | ' : '') + `Has ${i.implementations} implementation(s) - click to choose` }
        if (!cls) continue
        decos.push({ range: new monaco.Range(i.line, 1, i.line, 1), options: { linesDecorationsClassName: cls, linesDecorationsTooltip: tip } as monaco.editor.IModelDecorationOptions })
      }
      gutterDecos.current?.set(decos)
    })
  }

  useEffect(() => {
    const a = useIde.subscribe((s, prev) => {
      if (s.breakpoints !== prev.breakpoints) paintBreakpoints()
      if (s.bookmarks !== prev.bookmarks) paintBookmarks()
    })
    const b = useDebug.subscribe((s, prev) => {
      if (s.verified !== prev.verified || s.phase !== prev.phase || s.canBreakNow !== prev.canBreakNow) paintBreakpoints()
      if (s.frameId !== prev.frameId || s.phase !== prev.phase || s.frames !== prev.frames) paintExecution()
    })
    // Claude edited / someone reviewed a file: repaint if it's this one.
    const c = useEdits.subscribe((s, prev) => {
      const p = pathRef.current
      if (p && s.edits[fileKey(p)] !== prev.edits[fileKey(p)]) diffView.current?.paint(p)
    })
    return () => { a(); b(); c() }
  }, [])

  // ---- reveal requests (debugger stops, Go to line) ----
  const applyReveal = () => {
    const ed = edRef.current, p = pathRef.current
    const r = useIde.getState().reveal
    if (!ed || !p || !r || r.key !== fileKey(p) || !ed.getModel()) return
    const line = Math.min(r.line, ed.getModel()!.getLineCount())
    ed.revealLineInCenterIfOutsideViewport(line, monaco.editor.ScrollType.Smooth)
    ed.setPosition({ lineNumber: line, column: Math.max(1, r.col ?? 1) })
    ed.focus()
    useIde.setState({ reveal: null })
    // Brief highlight so the eye finds the line.
    flashDecos.current?.set([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'arw-reveal-flash' } }])
    window.setTimeout(() => flashDecos.current?.clear(), 1400)
  }
  useEffect(() => useIde.subscribe((s, prev) => { if (s.reveal !== prev.reveal) applyReveal() }), [])

  // ---- switch model when the tab changes ----
  useEffect(() => {
    const ed = edRef.current
    if (!ed) return
    let alive = true
    if (pathRef.current) viewStates.set(fileKey(pathRef.current), ed.saveViewState())
    pathRef.current = path
    setActivePath(path)
    if (!path) { ed.setModel(null); paintBreakpoints(); paintBookmarks(); paintGutter(); paintExecution(); diffView.current?.paint(null); useNav.setState({ fileInfo: null, caret: null }); return }
    void openModel(path).then(model => {
      if (!alive || pathRef.current !== path) return
      ed.setModel(model)
      if (model) {
        const vs = viewStates.get(fileKey(path))
        if (vs) ed.restoreViewState(vs)
        ed.focus()
      }
      paintBreakpoints()
      paintBookmarks()
      paintGutter()
      paintExecution()
      diffView.current?.paint(model ? path : null)
      applyReveal()
      if (model) {
        const o = model.getOptions()
        useNav.setState({ fileInfo: { eol: model.getEOL() === '\r\n' ? 'CRLF' : 'LF', bom: !!getEntry(path)?.bom, language: languageLabel(model.getLanguageId()), tabSize: o.tabSize, insertSpaces: o.insertSpaces } })
      } else useNav.setState({ fileInfo: null })
    })
    return () => { alive = false }
  }, [path])

  const status = useIde(s => (path ? s.files[fileKey(path)] : undefined))
  const notText = status && status.kind !== 'ready' && status.kind !== 'loading'

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0, visibility: notText ? 'hidden' : 'visible' }} />
      {review.count > 0 && path && !notText && (
        <div className="ai-review-bar">
          <span className="ai-review-title">✦ Claude {created ? 'created this file' : `changed this file`}</span>
          <span className="ai-review-count">{review.index + 1} of {review.count}</span>
          <button className="ai-review-nav" title="Previous change" onClick={() => diffView.current?.go(-1)}>↑</button>
          <button className="ai-review-nav" title="Next change" onClick={() => diffView.current?.go(1)}>↓</button>
          <span className="ai-review-sep" />
          {!created && <button className="ai-review-btn rej" onClick={() => void rejectAll(path)}>Reject all</button>}
          <button className="ai-review-btn acc" onClick={() => acceptAll(path)}>Accept all</button>
        </div>
      )}
      {status?.kind === 'image' && path && <ImageViewer path={path} dataUrl={status.dataUrl} size={status.size} />}
      {notText && status.kind !== 'image' && (
        <div className="ide-msg">
          {status.kind === 'binary' && 'This file is binary and can\'t be shown in the editor.'}
          {status.kind === 'tooLarge' && `This file is too large to open (${(status.size / 1048576).toFixed(1)} MB).`}
          {status.kind === 'error' && <>Couldn't open the file.<br /><span className="fx-err">{status.message}</span></>}
          {path && getEntry(path) == null && (
            <div style={{ marginTop: 12 }}>
              <button className="btn-soft" onClick={() => window.arw.openInExplorer(path)}>Open with default app</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function prefOptions(p: EditorPrefs): monaco.editor.IEditorOptions {
  return {
    fontSize: p.fontSize, lineHeight: Math.round(p.fontSize * 1.56),
    minimap: { enabled: p.minimap },
    wordWrap: p.wordWrap ? 'on' : 'off',
    stickyScroll: { enabled: p.stickyScroll },
    renderWhitespace: p.renderWhitespace ? 'all' : 'selection',
    lineDecorationsWidth: p.unityGutter ? 16 : 8
  }
}

const LANG_LABEL: Record<string, string> = { 'csharp-arw': 'C#', plaintext: 'Plain text', typescript: 'TypeScript', javascript: 'JavaScript', json: 'JSON', yaml: 'YAML', xml: 'XML', markdown: 'Markdown', cpp: 'HLSL / C++', css: 'CSS', html: 'HTML', python: 'Python', shell: 'Shell', powershell: 'PowerShell' }
const languageLabel = (id: string) => LANG_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
