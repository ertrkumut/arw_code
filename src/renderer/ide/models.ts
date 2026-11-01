import { monaco, languageFor, ensureMonaco } from './monaco'
import { fileKey } from './paths'
import { useIde } from '../store/ideStore'

/**
 * One Monaco text model per open file, shared by every view. Tracks the saved version
 * so the tab can show a dirty dot, and keeps the file's UTF-8 BOM for save.
 */
interface Entry { path: string; model: monaco.editor.ITextModel; savedVersion: number; bom: boolean; loading?: Promise<void> }
const entries = new Map<string, Entry>()

export const getEntry = (path: string) => entries.get(fileKey(path))

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
  entries.get(k)?.model.dispose()
  entries.delete(k)
  useIde.setState((st) => { const { [k]: _, ...rest } = st.files; return { files: rest } })
}

/**
 * Something changed on disk (e.g. Claude edited the file from a terminal). Clean buffers
 * reload in place — as an undoable edit, so the cursor and undo history survive. Buffers
 * with unsaved edits are left alone.
 */
export async function reloadIfClean(path: string) {
  const e = getEntry(path)
  if (!e || e.model.getAlternativeVersionId() !== e.savedVersion) return
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

/** Paths of open models living directly in one of these folders. */
export function openPathsIn(dirs: string[]): string[] {
  const keys = new Set(dirs.map(d => fileKey(d)))
  return [...entries.values()].map(e => e.path).filter(p => {
    const k = fileKey(p)
    return keys.has(k.slice(0, k.lastIndexOf('/')))
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
