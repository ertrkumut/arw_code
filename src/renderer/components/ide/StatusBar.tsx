import React from 'react'
import { useNav } from '../../store/navStore'
import { runCommand } from '../../ide/commands'
import { shortcutLabel } from '../../ide/keymap'

/** Bottom status bar: indexing progress, caret position, line endings, encoding, language. */
export function StatusBar() {
  const index = useNav(s => s.index)
  const caret = useNav(s => s.caret)
  const info = useNav(s => s.fileInfo)
  const indexing = index && index.state === 'indexing'
  return (
    <div className="sb-root">
      {indexing
        ? <span className="sb-item sb-index"><span className="sb-spin" />Indexing C#… {index!.done}/{index!.total}
            <span className="sb-bar"><span style={{ width: `${index!.total ? (index!.done / index!.total) * 100 : 0}%` }} /></span></span>
        : index?.state === 'ready'
          ? <span className="sb-item sb-muted" title="Project C# index: navigation, usages, completion">{index.files} C# files · {index.symbols} symbols</span>
          : null}
      <div style={{ flex: 1 }} />
      <button className="sb-item sb-btn" title={`Search Everywhere (${shortcutLabel('SearchEverywhere')})`} onClick={() => runCommand('arw.searchEverywhere')}>⌕</button>
      {caret && (
        <button className="sb-item sb-btn" title={`Go to Line (${shortcutLabel('GotoLine') || 'Ctrl+G'})`} onClick={() => runCommand('editor.action.gotoLine')}>
          {caret.line}:{caret.col}{caret.selection ? ` (${caret.selection} chars)` : ''}
        </button>
      )}
      {info && <>
        <span className="sb-item">{info.eol}</span>
        <span className="sb-item">UTF-8{info.bom ? ' BOM' : ''}</span>
        <span className="sb-item">{info.insertSpaces ? `${info.tabSize} spaces` : 'Tab'}</span>
        <span className="sb-item">{info.language}</span>
      </>}
      <button className="sb-item sb-btn" title={`Settings (${shortcutLabel('ShowSettings') || 'Ctrl+Alt+S'})`} onClick={() => runCommand('arw.settings')}>⚙</button>
    </div>
  )
}
