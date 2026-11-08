import { monaco, languageFor, ensureMonaco } from './monaco'
import { fileKey } from './paths'
import { useIde } from '../store/ideStore'
import { ideCtx, isCSharp } from './context'

/**
 * One Monaco text model per open file, shared by every view. Tracks the saved version
 * so the tab can show a dirty dot, and keeps the file's UTF-8 BOM for save.
 */
interface Entry { path: string; model: monaco.editor.ITextModel; savedVersion: number; bom: boolean; loading?: Promise<void> }
const entries = new Map<string, Entry>()

export const getEntry = (path: string) => entries.get(fileKey(path))

/** File path behind a model (models are keyed by path; this is the reverse lookup). */
export function pathOfModel(model: monaco.editor.ITextModel | null | undefined): string | null {
  if (!model) return null
  for (const e of entries.values()) if (e.model === model) return e.path
  return null
}

/** Text models currently open (path + model). */
export const openEntries = () => [...entries.values()].map(e => ({ path: e.path, model: e.model }))

/** Keep the C# index in main in step with unsaved edits (it overlays these buffers). */
function syncToIndex(e: Entry) {
  if (!isCSharp(e.path) || !ideCtx.root) return
  let t: number | undefined
  e.model.onDidChangeContent(() => {
    clearTimeout(t)
    t = window.setTimeout(() => { if (!e.model.isDisposed()) window.arw.code.update(ideCtx.root, e.path, e.model.getValue()) }, 350)
  })
}

function updateDirty(e: Entry) {
  const dirty = e.model.getAlternativeVersionId() !== e.savedVersion
  const cur = useIde.getState().files[fileKey(e.path)]
  if (cur?.kind !== 'ready' || cur.dirty !== dirty) useIde.getState().setFileStatus(e.path, { kind: 'ready', dirty })
}

/** Load (once) and return the model for a file, or null if it can't be edited as text. */
export async function openModel(path: string): Promise<monaco.editor.ITextModel | null> {
  ensureMonaco()
  const k = fileKey(path)
  const existing = entries.get(k)
  if (existing) { await existing.loading; return existing.model }

  const st = useIde.getState()
  st.setFileStatus(path, { kind: 'loading' })
  try {
    const f = await window.arw.fs.readFile(path)
    if (f.kind !== 'text') { st.setFileStatus(path, f); return null }
    if (entries.has(k)) return entries.get(k)!.model   // raced with another open
    const model = monaco.editor.createModel(f.content, languageFor(path), monaco.Uri.file(path))
    const e: Entry = { path, model, savedVersion: model.getAlternativeVersionId(), bom: f.bom }
    entries.set(k, e)
    model.onDidChangeContent(() => updateDirty(e))
    syncToIndex(e)
    updateDirty(e)
    return model
  } catch (err: any) {
    st.setFileStatus(path, { kind: 'error', message: String(err?.message ?? err) })
    return null
  }
}

export async function saveFile(path: string): Promise<boolean> {
  const e = getEntry(path)
  if (!e) return false
  const version = e.model.getAlternativeVersionId()
  try {
    await window.arw.fs.writeFile(e.path, e.model.getValue(monaco.editor.EndOfLinePreference.TextDefined), e.bom)
    e.savedVersion = version
    updateDirty(e)
    return true
  } catch (err: any) {
    useIde.setState({ notice: `Couldn't save ${e.path}: ${err?.message ?? err}` })
    return false
  }
}

export function isDirty(path: string): boolean {
  const e = getEntry(path)
  return !!e && e.model.getAlternativeVersionId() !== e.savedVersion
}

/** Drop a model when its tab closes (unless another project still has it open). */
export function releaseModel(path: string) {
  const k = fileKey(path)
  const stillOpen = Object.values(useIde.getState().tabs).some(t => t.paths.some(p => fileKey(p) === k))
  if (stillOpen) return
  const e = entries.get(k)
  e?.model.dispose()
  entries.delete(k)
  if (e && isCSharp(e.path) && ideCtx.root) window.arw.code.update(ideCtx.root, e.path, null)
  useIde.setState((st) => { const { [k]: _, ...rest } = st.files; return { files: rest } })
}

/**
 * Something changed on disk (e.g. Claude edited the file from a terminal). Clean buffers
 * reload in place — as an undoable edit, so the cursor and undo history survive. Buffers
 * with unsaved edits are left alone.
 */
export async function reloadIfClean(path: string) {
  const e = getEntry(path)
  if (!e) {
    // Not a text buffer — an open image tab just re-reads the file.
    const st = useIde.getState()
    if (st.files[fileKey(path)]?.kind !== 'image') return
    try { const f = await window.arw.fs.readFile(path); if (f.kind === 'image') st.setFileStatus(path, f) } catch { /* deleted */ }
    return
  }
  if (e.model.getAlternativeVersionId() !== e.savedVersion) return
  let f
  try { f = await window.arw.fs.readFile(e.path) } catch { return }   // deleted / locked
  if (f.kind !== 'text') return
  const cur = e.model.getValue(monaco.editor.EndOfLinePreference.TextDefined)
  if (cur === f.content || e.model.getAlternativeVersionId() !== e.savedVersion) return
  e.model.pushEditOperations([], [{ range: e.model.getFullModelRange(), text: f.content }], () => null)
  e.bom = f.bom
  e.savedVersion = e.model.getAlternativeVersionId()
  updateDirty(e)
}

/** Paths of open models (plus any `also` paths, e.g. image tabs) living directly in one of these folders. */
export function openPathsIn(dirs: string[], also: string[] = []): string[] {
  const keys = new Set(dirs.map(d => fileKey(d)))
  const seen = new Set<string>()
  return [...[...entries.values()].map(e => e.path), ...also].filter(p => {
    const k = fileKey(p)
    if (seen.has(k) || !keys.has(k.slice(0, k.lastIndexOf('/')))) return false
    seen.add(k)
    return true
  })
}

/** Paths of every open buffer with unsaved changes. */
export function dirtyPaths(): string[] {
  return [...entries.values()].filter(e => e.model.getAlternativeVersionId() !== e.savedVersion).map(e => e.path)
}

/** Save every dirty buffer (Rider: Ctrl+S is Save All). Returns false if any save failed. */
export async function saveAll(): Promise<boolean> {
  const results = await Promise.all(dirtyPaths().map(p => saveFile(p)))
  return results.every(Boolean)
}
