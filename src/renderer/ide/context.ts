import { monaco } from './monaco'
import { makeDoc, type Doc } from '@shared/csharpAnalysis'
import { extOf, fileKey } from './paths'
import { useIde } from '../store/ideStore'
import { useNav, type Loc } from '../store/navStore'

/**
 * The IDE window's context for code-insight commands: which project it shows, the one
 * Monaco editor, and helpers to jump around while recording navigation history.
 */
export const ideCtx = { projectId: '', root: '', isUnity: false }

let editor: monaco.editor.IStandaloneCodeEditor | null = null
let activePath: string | null = null
export function setActiveEditor(ed: monaco.editor.IStandaloneCodeEditor | null) { editor = ed }
export function getEditor() { return editor }
export function setActivePath(p: string | null) { activePath = p }
export function getActivePath() { return activePath }

export const isCSharp = (path: string | null | undefined) => !!path && (extOf(path) === 'cs' || extOf(path) === 'csx')

/** Where the caret is now (for history). */
export function currentLoc(): Loc | null {
  const pos = editor?.getPosition()
  if (!editor || !activePath || !pos) return null
  return { path: activePath, line: pos.lineNumber, col: pos.column }
}

/** Open a file at a position, remembering where we came from (Ctrl+Alt+← goes back). */
export function navigateTo(loc: Loc, record = true) {
  const st = useNav.getState()
  if (record) {
    const cur = currentLoc()
    if (cur) st.pushHistory(cur)
    st.pushHistory(loc)
  }
  useIde.getState().openFile(ideCtx.projectId, loc.path, loc.line, loc.col)
}

export function goBack() {
  const st = useNav.getState()
  const cur = currentLoc()
  let i = st.historyIndex
  const h = st.history
  if (cur && (i < 0 || fileKey(h[i].path) !== fileKey(cur.path) || Math.abs(h[i].line - cur.line) > 2)) {
    st.pushHistory(cur)
    i = useNav.getState().historyIndex
  }
  if (i <= 0) return
  const target = useNav.getState().history[i - 1]
  useNav.setState({ historyIndex: i - 1 })
  useIde.getState().openFile(ideCtx.projectId, target.path, target.line, target.col)
}

export function goForward() {
  const st = useNav.getState()
  if (st.historyIndex >= st.history.length - 1) return
  const target = st.history[st.historyIndex + 1]
  useNav.setState({ historyIndex: st.historyIndex + 1 })
  useIde.getState().openFile(ideCtx.projectId, target.path, target.line, target.col)
}

// ---- parsed buffers (cached per model version) ----

const docs = new WeakMap<monaco.editor.ITextModel, { v: number; doc: Doc }>()

export function docFor(model: monaco.editor.ITextModel, path: string): Doc {
  const v = model.getAlternativeVersionId()
  const c = docs.get(model)
  if (c && c.v === v) return c.doc
  const doc = makeDoc(path, model.getValue())
  docs.set(model, { v, doc })
  return doc
}

/** Screen point just under the caret, for popups. */
export function caretAnchor(): { x: number; y: number } | undefined {
  const ed = editor, pos = ed?.getPosition()
  if (!ed || !pos) return undefined
  const p = ed.getScrolledVisiblePosition(pos)
  const r = ed.getDomNode()?.getBoundingClientRect()
  if (!p || !r) return undefined
  return { x: r.left + p.left, y: r.top + p.top + p.height + 2 }
}

/** Rider-style hint bubble at the caret ("Cannot find declaration to go to"). */
export function showEditorMessage(text: string) {
  const ed = editor, pos = ed?.getPosition()
  if (!ed || !pos) return
  const mc = ed.getContribution('editor.contrib.messageController') as unknown as { showMessage?: (m: string, p: monaco.IPosition) => void } | null
  mc?.showMessage?.(text, pos)
}

export const codeQuery = <T>(op: string, args?: unknown) => window.arw.code.query<T>(ideCtx.root, op, args)
