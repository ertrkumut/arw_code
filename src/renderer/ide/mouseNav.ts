import { monaco } from './monaco'
import type { Resolution } from '@shared/csharpAnalysis'
import { codeQuery, getActivePath, isCSharp } from './context'
import { runCommand } from './commands'

/**
 * Rider mouse navigation: hold Ctrl and hover → the identifier underlines when it can be
 * navigated; Ctrl+Click (or middle-click) → Go to Declaration or Usages.
 */
export function installMouseNavigation(ed: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  const deco = ed.createDecorationsCollection()
  const T = monaco.editor.MouseTargetType
  let lastKey = ''
  let token = 0
  const node = ed.getDomNode()

  const clear = () => {
    deco.clear()
    lastKey = ''
    token++
    node?.classList.remove('arw-ctrl-nav')
  }

  const subs: monaco.IDisposable[] = []
  subs.push(ed.onMouseMove((e) => {
    const ctrl = e.event.ctrlKey || e.event.metaKey
    const path = getActivePath()
    const model = ed.getModel()
    const pos = e.target.position
    if (!ctrl || e.target.type !== T.CONTENT_TEXT || !pos || !model || !isCSharp(path)) { if (lastKey) clear(); return }
    const w = model.getWordAtPosition(pos)
    if (!w) { if (lastKey) clear(); return }
    const key = `${pos.lineNumber}:${w.startColumn}:${model.getAlternativeVersionId()}`
    if (key === lastKey) return
    lastKey = key
    const my = ++token
    void codeQuery<Resolution>('resolve', { path, src: model.getValue(), offset: model.getOffsetAt(pos) }).then(r => {
      if (my !== token) return
      if (r.kind === 'symbols' || r.kind === 'local') {
        deco.set([{ range: new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn), options: { inlineClassName: 'arw-ctrl-link' } }])
        node?.classList.add('arw-ctrl-nav')
      } else { deco.clear(); node?.classList.remove('arw-ctrl-nav') }
    }).catch(() => {})
  }))
  subs.push(ed.onMouseLeave(clear))
  const keyup = (e: KeyboardEvent) => { if (e.key === 'Control' || e.key === 'Meta') clear() }
  window.addEventListener('keyup', keyup)
  window.addEventListener('blur', clear)

  subs.push(ed.onMouseDown((e) => {
    const ev = e.event
    const nav = (ev.leftButton && (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey) || ev.middleButton
    if (!nav || e.target.type !== T.CONTENT_TEXT || !e.target.position) return
    if (!isCSharp(getActivePath())) return
    ev.preventDefault()
    ev.stopPropagation()
    const pos = e.target.position
    clear()
    // let Monaco finish its own mousedown handling first, then move the caret and navigate
    window.setTimeout(() => {
      ed.setPosition(pos)
      runCommand('arw.gotoDeclaration')
    }, 0)
  }))

  return {
    dispose() {
      subs.forEach(s => s.dispose())
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', clear)
      deco.clear()
    }
  }
}
