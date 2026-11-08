import { monaco } from './monaco'
import { getEntry, saveFile, isDirty } from './models'
import { editFor } from '../store/editsStore'
import { acceptHunk as acceptIntoBaseline, diffLines, splitLines, sameText, type LineHunk } from '@shared/agentEdits'

/**
 * Accept / reject Claude's changes in an open buffer. Accepting moves a change into the
 * baseline (it stops showing as a change); rejecting writes the baseline text back into
 * the file — as an undoable edit, saved right away when the buffer had nothing unsaved.
 */

/** Changes in a file's open buffer vs its baseline (empty when not tracked / not open). */
export function hunksOf(path: string): LineHunk[] {
  const e = editFor(path), m = getEntry(path)?.model
  if (!e || !m) return []
  return diffLines(splitLines(e.baseline), m.getLinesContent())
}

/** Tell main the new baseline, or that the file is fully reviewed. */
function commitBaseline(path: string, baseline: string[]) {
  const m = getEntry(path)?.model
  const text = baseline.join(m?.getEOL() ?? '\n')
  const done = m ? sameText(text, m.getValue()) : false
  window.arw.edits.set(editFor(path)?.path ?? path, done ? null : text)
}

export function acceptChange(path: string, h: LineHunk) {
  const e = editFor(path), m = getEntry(path)?.model
  if (!e || !m) return
  commitBaseline(path, acceptIntoBaseline(splitLines(e.baseline), m.getLinesContent(), h))
}

export function acceptAll(path: string) {
  const e = editFor(path)
  if (e) window.arw.edits.set(e.path, null)
}

/** Replace `count` lines starting at 0-based `start` with `lines` (count 0 = insert). */
function replaceLines(m: monaco.editor.ITextModel, start: number, count: number, lines: string[]) {
  const total = m.getLineCount(), eol = m.getEOL()
  let range: monaco.Range, text: string
  if (count > 0 && start + count < total) {
    range = new monaco.Range(start + 1, 1, start + count + 1, 1)
    text = lines.map(l => l + eol).join('')
  } else if (count > 0 && start > 0) {
    // the change runs to the end of the file: eat the line break before it instead
    range = new monaco.Range(start, m.getLineMaxColumn(start), total, m.getLineMaxColumn(total))
    text = lines.map(l => eol + l).join('')
  } else if (count > 0) {
    range = m.getFullModelRange()
    text = lines.join(eol)
  } else if (start < total) {
    range = new monaco.Range(start + 1, 1, start + 1, 1)
    text = lines.map(l => l + eol).join('')
  } else {
    range = new monaco.Range(total, m.getLineMaxColumn(total), total, m.getLineMaxColumn(total))
    text = lines.map(l => eol + l).join('')
  }
  m.pushEditOperations([], [{ range, text }], () => null)
}

async function afterReject(path: string, wasDirty: boolean) {
  if (!wasDirty) await saveFile(path)
  const e = editFor(path), m = getEntry(path)?.model
  if (e && m && sameText(e.baseline, m.getValue())) window.arw.edits.set(e.path, null)
}

export async function rejectChange(path: string, h: LineHunk) {
  const e = editFor(path), m = getEntry(path)?.model
  if (!e || !m) return
  const wasDirty = isDirty(path)
  const base = splitLines(e.baseline)
  replaceLines(m, h.modStart, h.modCount, base.slice(h.origStart, h.origStart + h.origCount))
  await afterReject(path, wasDirty)
}

export async function rejectAll(path: string) {
  const e = editFor(path), m = getEntry(path)?.model
  if (!e || !m) return
  const wasDirty = isDirty(path)
  m.pushEditOperations([], [{ range: m.getFullModelRange(), text: splitLines(e.baseline).join(m.getEOL()) }], () => null)
  await afterReject(path, wasDirty)
}
