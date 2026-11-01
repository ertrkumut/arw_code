import React, { useEffect, useRef } from 'react'
import { monaco, ensureMonaco, monacoThemeName, CSHARP } from '../../ide/monaco'
import { openModel, getEntry } from '../../ide/models'
import { installRiderKeymap, setActiveEditor } from '../../ide/keymap'
import { fileKey, extOf, expressionAt } from '../../ide/paths'
import { useIde } from '../../store/ideStore'
import { useDebug, executionPoint } from '../../store/debugStore'
import { getTheme } from '../../themes'

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
  const themeId = useIde(s => s.themeId)

  // ---- create once ----
  useEffect(() => {
    ensureMonaco()
    registerDebugHover()
    const ed = monaco.editor.create(hostRef.current!, {
      model: null,
      theme: monacoThemeName(getTheme(useIde.getState().themeId)),
      automaticLayout: true,
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: 13.5, lineHeight: 21, fontLigatures: true,
      glyphMargin: true, lineNumbersMinChars: 4, lineDecorationsWidth: 8,
      folding: true, showFoldingControls: 'mouseover',
      minimap: { enabled: false },
      renderLineHighlight: 'all', cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
      smoothScrolling: true, scrollBeyondLastLine: false, mouseWheelZoom: true,
      guides: { indentation: true, bracketPairs: false, highlightActiveIndentation: true },
      bracketPairColorization: { enabled: false },
      stickyScroll: { enabled: true },
      padding: { top: 6 },
      scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12, useShadows: false },
      fixedOverflowWidgets: true
    })
    edRef.current = ed
    bpDecos.current = ed.createDecorationsCollection()
    execDecos.current = ed.createDecorationsCollection()
    hoverDecos.current = ed.createDecorationsCollection()

    // Rider keymap (ide/keymap.ts). Ctrl+F8 toggles a line breakpoint at the caret.
    installRiderKeymap((command, editor) => {
      if (command !== 'arw.toggleBreakpoint') return
      const p = pathRef.current, pos = editor.getPosition()
      if (p && pos && canBreak(p)) useIde.getState().toggleBreakpoint(p, pos.lineNumber)
    })
    setActiveEditor(ed)

    // Click in the gutter (glyph margin or line numbers) toggles a breakpoint, like Rider.
    const T = monaco.editor.MouseTargetType
    ed.onMouseDown((e) => {
      const p = pathRef.current
      if (!p || !canBreak(p) || e.event.rightButton) return
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
    let syncTimer: number | undefined
    ed.onDidChangeModelContent(() => {
      clearTimeout(syncTimer)
      syncTimer = window.setTimeout(() => {
        const p = pathRef.current
        const model = ed.getModel()
        if (!p || !model || !bpDecos.current) return
        const lines = bpDecos.current.getRanges().map(r => r.startLineNumber)
        useIde.getState().setBreakpointLines(p, lines)
      }, 250)
    })

    return () => {
      clearTimeout(syncTimer)
      if (pathRef.current) viewStates.set(fileKey(pathRef.current), ed.saveViewState())
      setActiveEditor(null)
      ed.dispose()
      edRef.current = null
    }
  }, [])

  // ---- theme ----
  useEffect(() => { monaco.editor.setTheme(monacoThemeName(getTheme(themeId))) }, [themeId])

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

  useEffect(() => {
    const a = useIde.subscribe((s, prev) => { if (s.breakpoints !== prev.breakpoints) paintBreakpoints() })
    const b = useDebug.subscribe((s, prev) => {
      if (s.verified !== prev.verified || s.phase !== prev.phase || s.canBreakNow !== prev.canBreakNow) paintBreakpoints()
      if (s.frameId !== prev.frameId || s.phase !== prev.phase || s.frames !== prev.frames) paintExecution()
    })
    return () => { a(); b() }
  }, [])

  // ---- reveal requests (debugger stops, Go to line) ----
  const applyReveal = () => {
    const ed = edRef.current, p = pathRef.current
    const r = useIde.getState().reveal
    if (!ed || !p || !r || r.key !== fileKey(p) || !ed.getModel()) return
    ed.revealLineInCenterIfOutsideViewport(r.line, monaco.editor.ScrollType.Smooth)
    ed.setPosition({ lineNumber: r.line, column: 1 })
    useIde.setState({ reveal: null })
  }
  useEffect(() => useIde.subscribe((s, prev) => { if (s.reveal !== prev.reveal) applyReveal() }), [])

  // ---- switch model when the tab changes ----
  useEffect(() => {
    const ed = edRef.current
    if (!ed) return
    let alive = true
    if (pathRef.current) viewStates.set(fileKey(pathRef.current), ed.saveViewState())
    pathRef.current = path
    if (!path) { ed.setModel(null); paintBreakpoints(); paintExecution(); return }
    void openModel(path).then(model => {
      if (!alive || pathRef.current !== path) return
      ed.setModel(model)
      if (model) {
        const vs = viewStates.get(fileKey(path))
        if (vs) ed.restoreViewState(vs)
        ed.focus()
      }
      paintBreakpoints()
      paintExecution()
      applyReveal()
    })
    return () => { alive = false }
  }, [path])

  const status = useIde(s => (path ? s.files[fileKey(path)] : undefined))
  const notText = status && status.kind !== 'ready' && status.kind !== 'loading'

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0, visibility: notText ? 'hidden' : 'visible' }} />
      {notText && (
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
