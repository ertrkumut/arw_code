import { monaco } from './monaco'
import { editFor } from '../store/editsStore'
import { hunksOf, acceptChange, rejectChange } from './agentReview'
import { splitLines, type LineHunk } from '@shared/agentEdits'

/** Removed lines shown inline before we switch to a "N lines removed" summary. */
const MAX_ZONE_LINES = 40

/**
 * Paints Claude's changes into the editor, Antigravity-style: added/changed lines get a
 * green background and gutter bar, removed lines show as red ghost lines in a view zone,
 * and each change gets a small Accept / Reject pill.
 */
export class AgentDiffView {
  private decos: monaco.editor.IEditorDecorationsCollection
  private zones: string[] = []
  private widgets: monaco.editor.IContentWidget[] = []
  hunks: LineHunk[] = []

  constructor(private ed: monaco.editor.IStandaloneCodeEditor, private onChange: (hunks: LineHunk[]) => void) {
    this.decos = ed.createDecorationsCollection()
  }

  paint(path: string | null) {
    const model = this.ed.getModel()
    const edit = editFor(path)
    const hunks = path && model && edit ? hunksOf(path) : []
    this.clear()
    this.hunks = hunks
    this.onChange(hunks)
    if (!hunks.length || !model || !edit || !path) return

    const base = splitLines(edit.baseline)
    const lang = model.getLanguageId()
    const decos: monaco.editor.IModelDeltaDecoration[] = []
    const lineCount = model.getLineCount()

    for (const h of hunks) {
      if (h.modCount > 0) {
        decos.push({
          range: new monaco.Range(h.modStart + 1, 1, h.modStart + h.modCount, 1),
          options: {
            isWholeLine: true,
            className: 'arw-ai-add',
            linesDecorationsClassName: h.origCount > 0 ? 'arw-ai-gutter-mod' : 'arw-ai-gutter-add',
            overviewRuler: { color: '#5FB865', position: monaco.editor.OverviewRulerLane.Left },
            minimap: { color: '#5FB865', position: monaco.editor.MinimapPosition.Gutter }
          }
        })
      } else {
        // pure removal: mark the spot in the overview ruler
        const l = Math.max(1, Math.min(h.modStart, lineCount))
        decos.push({ range: new monaco.Range(l, 1, l, 1), options: {
          overviewRuler: { color: '#DB5C5C', position: monaco.editor.OverviewRulerLane.Left } } })
      }
    }
    this.decos.set(decos)

    // Removed lines as ghost lines above where they were.
    this.ed.changeViewZones((acc) => {
      for (const h of hunks) {
        if (!h.origCount) continue
        const removed = base.slice(h.origStart, h.origStart + h.origCount)
        const shown = removed.length > MAX_ZONE_LINES ? removed.slice(0, MAX_ZONE_LINES) : removed
        const dom = document.createElement('div')
        dom.className = 'arw-ai-del-zone'
        const code = document.createElement('div')
        code.className = 'arw-ai-del-code'
        code.textContent = shown.join('\n')
        dom.appendChild(code)
        if (removed.length > shown.length) {
          const more = document.createElement('div')
          more.className = 'arw-ai-del-more'
          more.textContent = `… ${removed.length - shown.length} more removed lines`
          dom.appendChild(more)
        }
        // Syntax colours, like the rest of the editor.
        void monaco.editor.colorize(shown.join('\n'), lang, { tabSize: model.getOptions().tabSize })
          .then(html => { code.innerHTML = html }).catch(() => {})
        this.zones.push(acc.addZone({
          afterLineNumber: h.modStart,
          heightInLines: shown.length + (removed.length > shown.length ? 1 : 0),
          domNode: dom,
          suppressMouseDown: true
        }))
      }
    })

    // Accept / Reject pill at the end of each change's first line.
    hunks.forEach((h, i) => {
      const line = h.modCount > 0 ? h.modStart + 1 : Math.max(1, Math.min(h.modStart, lineCount))
      const dom = document.createElement('div')
      dom.className = 'arw-ai-pill'
      const btn = (label: string, cls: string, title: string, run: () => void) => {
        const b = document.createElement('button')
        b.className = cls
        b.textContent = label
        b.title = title
        b.onmousedown = (e) => { e.preventDefault(); e.stopPropagation() }
        b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); run() }
        dom.appendChild(b)
      }
      if (!edit.created) btn('Reject', 'rej', 'Undo this change', () => void rejectChange(path, h))
      btn('Accept', 'acc', 'Keep this change', () => acceptChange(path, h))
      const w: monaco.editor.IContentWidget = {
        getId: () => `arw-ai-pill-${i}`,
        getDomNode: () => dom,
        getPosition: () => ({
          position: { lineNumber: line, column: model.getLineMaxColumn(line) },
          preference: [monaco.editor.ContentWidgetPositionPreference.EXACT]
        })
      }
      this.ed.addContentWidget(w)
      this.widgets.push(w)
    })
  }

  /** Move the caret to the next / previous change. */
  go(dir: 1 | -1) {
    if (!this.hunks.length) return
    const cur = this.ed.getPosition()?.lineNumber ?? 1
    const starts = this.hunks.map(h => Math.max(1, h.modCount > 0 ? h.modStart + 1 : h.modStart))
    let idx = dir > 0 ? starts.findIndex(s => s > cur) : starts.map((s, i) => [s, i]).reverse().find(([s]) => s < cur)?.[1] ?? -1
    if (idx < 0) idx = dir > 0 ? 0 : starts.length - 1
    this.reveal(starts[idx])
  }

  /** Which change (0-based) the caret is in or after, for the "2 of 5" counter. */
  currentIndex(): number {
    const cur = this.ed.getPosition()?.lineNumber ?? 1
    let idx = 0
    this.hunks.forEach((h, i) => { if (Math.max(1, h.modStart) <= cur) idx = i })
    return idx
  }

  private reveal(line: number) {
    this.ed.revealLineInCenter(line, monaco.editor.ScrollType.Smooth)
    this.ed.setPosition({ lineNumber: line, column: 1 })
    this.ed.focus()
  }

  clear() {
    this.decos.clear()
    if (this.zones.length) this.ed.changeViewZones((acc) => this.zones.forEach(z => acc.removeZone(z)))
    this.zones = []
    this.widgets.forEach(w => this.ed.removeContentWidget(w))
    this.widgets = []
    this.hunks = []
  }

  dispose() { this.clear() }
}
