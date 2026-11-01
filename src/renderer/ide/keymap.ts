import { monaco } from './monaco'

/**
 * Editor key bindings, taken from the user's Rider keymap:
 *   %APPDATA%/JetBrains/Rider2025.3/keymaps/"IntelliJ copy.xml"  (active keymap, parent "$default")
 * Actions the user customized use their custom keys; everything else uses Rider's
 * IntelliJ "$default" keymap. Actions with no editor equivalent here (no C# language
 * server: Go to Declaration, Quick Doc, Alt+Enter…) are left out.
 *
 * Keys are written the way Rider's keymap XML writes them ("ctrl shift SLASH"); a second
 * entry after a comma is a chord ("ctrl M, S").
 *
 * `command` is a Monaco command id, or an `arw.*` command implemented below / by the IDE window.
 */
export interface KeyBinding { action: string; keys: string[]; command: string; custom?: boolean }

export const RIDER_KEYMAP: KeyBinding[] = [
  // ---- user's customizations ("IntelliJ copy") ----
  { action: 'CloseContent', keys: ['ctrl W'], command: 'arw.closeTab', custom: true },
  { action: 'CollapseRegion', keys: ['ctrl M, S'], command: 'editor.fold', custom: true },
  { action: 'ExpandRegion', keys: ['ctrl M, E'], command: 'editor.unfold', custom: true },
  { action: 'CommentByLineComment', keys: ['ctrl shift SLASH'], command: 'editor.action.commentLine', custom: true },
  { action: 'EditorLineStart', keys: ['ctrl LEFT', 'HOME'], command: 'cursorHome', custom: true },
  { action: 'EditorLineEnd', keys: ['ctrl RIGHT', 'END'], command: 'cursorEnd', custom: true },
  { action: 'EditorLineStartWithSelection', keys: ['ctrl shift LEFT', 'shift HOME'], command: 'cursorHomeSelect', custom: true },
  { action: 'EditorLineEndWithSelection', keys: ['ctrl shift RIGHT', 'shift END'], command: 'cursorEndSelect', custom: true },
  { action: 'EditorMoveToPageTop', keys: ['ctrl UP'], command: 'arw.pageTop', custom: true },
  { action: 'EditorMoveToPageBottom', keys: ['ctrl DOWN'], command: 'arw.pageBottom', custom: true },
  { action: 'EditorNextWord', keys: ['alt RIGHT'], command: 'cursorWordEndRight', custom: true },
  { action: 'EditorPreviousWord', keys: ['alt LEFT'], command: 'cursorWordStartLeft', custom: true },
  { action: 'EditorNextWordWithSelection', keys: ['alt shift RIGHT'], command: 'cursorWordEndRightSelect', custom: true },
  { action: 'EditorPreviousWordWithSelection', keys: ['alt shift LEFT'], command: 'cursorWordStartLeftSelect', custom: true },
  { action: 'GotoClass', keys: ['ctrl P'], command: 'arw.gotoClass', custom: true },
  { action: 'RenameElement', keys: ['ctrl R'], command: 'editor.action.changeAll', custom: true },   // rename all occurrences in the file
  { action: 'SelectNextOccurrence', keys: ['ctrl E'], command: 'editor.action.addSelectionToNextFindMatch', custom: true },

  // ---- Rider "$default" (IntelliJ) ----
  { action: 'SaveAll', keys: ['ctrl S'], command: 'arw.saveAll' },
  { action: 'GotoLine', keys: ['ctrl G'], command: 'editor.action.gotoLine' },
  { action: 'GotoFile', keys: ['ctrl shift N'], command: 'arw.gotoFile' },
  { action: 'Find', keys: ['ctrl F', 'alt F3'], command: 'actions.find' },
  { action: 'FindNext', keys: ['F3', 'ctrl L'], command: 'editor.action.nextMatchFindAction' },
  { action: 'FindPrevious', keys: ['shift F3', 'ctrl shift L'], command: 'editor.action.previousMatchFindAction' },
  { action: 'EditorDuplicate', keys: ['ctrl D'], command: 'editor.action.copyLinesDownAction' },
  { action: 'EditorDeleteLine', keys: ['ctrl Y'], command: 'editor.action.deleteLines' },
  { action: 'MoveLineUp', keys: ['alt shift UP'], command: 'editor.action.moveLinesUpAction' },
  { action: 'MoveLineDown', keys: ['alt shift DOWN'], command: 'editor.action.moveLinesDownAction' },
  { action: 'MoveStatementUp', keys: ['ctrl shift UP'], command: 'editor.action.moveLinesUpAction' },
  { action: 'MoveStatementDown', keys: ['ctrl shift DOWN'], command: 'editor.action.moveLinesDownAction' },
  { action: 'EditorUnSelectWord', keys: ['ctrl shift W'], command: 'editor.action.smartSelect.shrink' },
  { action: 'UnselectPreviousOccurrence', keys: ['alt shift J'], command: 'cursorUndo' },
  { action: 'SelectAllOccurrences', keys: ['ctrl alt shift J'], command: 'editor.action.selectHighlights' },
  { action: 'ExpandAllRegions', keys: ['ctrl shift ADD', 'ctrl shift EQUALS'], command: 'editor.unfoldAll' },
  { action: 'CollapseAllRegions', keys: ['ctrl shift SUBTRACT', 'ctrl shift MINUS'], command: 'editor.foldAll' },
  { action: 'ExpandRegionRecursively', keys: ['ctrl alt ADD', 'ctrl alt EQUALS'], command: 'editor.unfoldRecursively' },
  { action: 'CollapseRegionRecursively', keys: ['ctrl alt SUBTRACT', 'ctrl alt MINUS'], command: 'editor.foldRecursively' },
  { action: 'ReformatCode', keys: ['ctrl alt L'], command: 'editor.action.formatDocument' },
  { action: 'EditorStartNewLine', keys: ['shift ENTER'], command: 'editor.action.insertLineAfter' },
  { action: 'EditorStartNewLineBefore', keys: ['ctrl alt ENTER'], command: 'editor.action.insertLineBefore' },
  { action: 'EditorJoinLines', keys: ['ctrl shift J'], command: 'editor.action.joinLines' },
  { action: 'EditorToggleCase', keys: ['ctrl shift U'], command: 'arw.toggleCase' },
  { action: '$Undo', keys: ['ctrl Z', 'alt BACK_SPACE'], command: 'undo' },
  { action: '$Redo', keys: ['ctrl shift Z', 'alt shift BACK_SPACE'], command: 'redo' },
  { action: 'CodeCompletion', keys: ['ctrl SPACE'], command: 'editor.action.triggerSuggest' },
  { action: 'EditorTextStart', keys: ['ctrl HOME'], command: 'cursorTop' },
  { action: 'EditorTextEnd', keys: ['ctrl END'], command: 'cursorBottom' },
  { action: 'EditorDeleteToWordStart', keys: ['ctrl BACK_SPACE'], command: 'deleteWordLeft' },
  { action: 'EditorDeleteToWordEnd', keys: ['ctrl DELETE'], command: 'deleteWordRight' },
  { action: 'EditorAddCaretPerSelectedLine', keys: ['alt shift G'], command: 'editor.action.insertCursorAtEndOfEachLineSelected' },
  { action: 'ToggleLineBreakpoint', keys: ['ctrl F8'], command: 'arw.toggleBreakpoint' },

  // ---- debugger + tool windows (handled by the IDE window, work from anywhere in it) ----
  { action: 'Debug', keys: ['shift F9'], command: 'arw.debug' },
  { action: 'Resume', keys: ['F9'], command: 'arw.resume' },
  { action: 'StepOver', keys: ['F8'], command: 'arw.stepOver' },
  { action: 'StepInto', keys: ['F7'], command: 'arw.stepInto' },
  { action: 'StepOut', keys: ['shift F8'], command: 'arw.stepOut' },
  { action: 'Stop', keys: ['ctrl F2'], command: 'arw.stop' },
  { action: 'ActivateProjectToolWindow', keys: ['alt 1'], command: 'arw.toggleTree' },
  { action: 'ActivateDebugToolWindow', keys: ['alt 5'], command: 'arw.toggleDebug' },
  { action: 'HideAllWindows', keys: ['ctrl shift F12'], command: 'arw.hideAll' }
]

/** Commands the IDE window handles itself (outside the editor too). */
export const WINDOW_COMMANDS = new Set([
  'arw.closeTab', 'arw.saveAll', 'arw.gotoFile', 'arw.gotoClass', 'arw.debug', 'arw.resume', 'arw.stepOver',
  'arw.stepInto', 'arw.stepOut', 'arw.stop', 'arw.toggleTree', 'arw.toggleDebug', 'arw.hideAll'
])

/**
 * Monaco defaults that would fight the Rider keys (same key, different action), or that
 * Rider doesn't have on that key. Removed so the Rider binding wins.
 */
const MONACO_CONFLICTS: [string, string][] = [
  ['ctrl D', 'editor.action.addSelectionToNextFindMatch'],
  ['ctrl Y', 'redo'],
  ['ctrl L', 'expandLineSelection'],
  ['ctrl shift L', 'editor.action.selectHighlights'],
  ['ctrl SLASH', 'editor.action.commentLine'],
  ['ctrl M', 'editor.action.toggleTabFocusMode'],
  ['ctrl F2', 'editor.action.changeAll'],
  ['F2', 'editor.action.rename'],
  ['F8', 'editor.action.marker.nextInFiles'],
  ['shift F8', 'editor.action.marker.prevInFiles'],
  ['alt F8', 'editor.action.marker.next'],
  ['F7', 'editor.action.accessibleDiffViewer.next'],
  ['ctrl LEFT', 'cursorWordStartLeft'],
  ['ctrl RIGHT', 'cursorWordEndRight'],
  ['ctrl shift LEFT', 'cursorWordStartLeftSelect'],
  ['ctrl shift RIGHT', 'cursorWordEndRightSelect'],
  ['ctrl UP', 'scrollLineUp'],
  ['ctrl DOWN', 'scrollLineDown'],
  ['alt shift UP', 'editor.action.copyLinesUpAction'],
  ['alt shift DOWN', 'editor.action.copyLinesDownAction'],
  ['ctrl shift UP', 'editor.action.insertCursorAbove'],
  ['ctrl shift DOWN', 'editor.action.insertCursorBelow'],
  ['alt UP', 'editor.action.moveLinesUpAction'],
  ['alt DOWN', 'editor.action.moveLinesDownAction'],
  ['shift alt RIGHT', 'editor.action.smartSelect.expand'],
  ['shift alt LEFT', 'editor.action.smartSelect.shrink']
]

const KEYS: Record<string, number> = {
  LEFT: monaco.KeyCode.LeftArrow, RIGHT: monaco.KeyCode.RightArrow, UP: monaco.KeyCode.UpArrow, DOWN: monaco.KeyCode.DownArrow,
  HOME: monaco.KeyCode.Home, END: monaco.KeyCode.End, PAGE_UP: monaco.KeyCode.PageUp, PAGE_DOWN: monaco.KeyCode.PageDown,
  ENTER: monaco.KeyCode.Enter, TAB: monaco.KeyCode.Tab, SPACE: monaco.KeyCode.Space, ESCAPE: monaco.KeyCode.Escape,
  BACK_SPACE: monaco.KeyCode.Backspace, DELETE: monaco.KeyCode.Delete, INSERT: monaco.KeyCode.Insert,
  SLASH: monaco.KeyCode.Slash, MINUS: monaco.KeyCode.Minus, EQUALS: monaco.KeyCode.Equal,
  ADD: monaco.KeyCode.NumpadAdd, SUBTRACT: monaco.KeyCode.NumpadSubtract, DIVIDE: monaco.KeyCode.NumpadDivide
}

/** "ctrl shift SLASH" -> Monaco keybinding number. */
function stroke(s: string): number {
  let mods = 0, key = 0
  for (const part of s.trim().split(/\s+/)) {
    const p = part.toLowerCase()
    if (p === 'ctrl' || p === 'control') mods |= monaco.KeyMod.CtrlCmd
    else if (p === 'shift') mods |= monaco.KeyMod.Shift
    else if (p === 'alt') mods |= monaco.KeyMod.Alt
    else if (p === 'meta') mods |= monaco.KeyMod.WinCtrl
    else {
      const u = part.toUpperCase()
      key = KEYS[u]
        ?? (/^F\d{1,2}$/.test(u) ? (monaco.KeyCode as any)[u]
        : /^[A-Z]$/.test(u) ? (monaco.KeyCode as any)[`Key${u}`]
        : /^\d$/.test(u) ? (monaco.KeyCode as any)[`Digit${u}`] : 0)
    }
  }
  return mods | key
}

export function toMonacoKey(spec: string): number {
  const [a, b] = spec.split(',')
  return b ? monaco.KeyMod.chord(stroke(a), stroke(b)) : stroke(a)
}

/** Matches a DOM keydown against a single-stroke spec ("shift F9"). Chords never match here. */
export function matchesKey(e: KeyboardEvent, spec: string): boolean {
  if (spec.includes(',')) return false
  const parts = spec.toLowerCase().split(/\s+/)
  const want = { ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt') }
  if (e.ctrlKey !== want.ctrl || e.shiftKey !== want.shift || e.altKey !== want.alt || e.metaKey) return false
  const key = parts.find(p => !['ctrl', 'shift', 'alt', 'meta'].includes(p))!.toUpperCase()
  if (/^F\d{1,2}$/.test(key) || /^[A-Z]$/.test(key)) return e.code === (key.length === 1 ? `Key${key}` : key)
  if (/^\d$/.test(key)) return e.code === `Digit${key}`
  return false
}

let installed = false
/** Remove Monaco's conflicting defaults and bind the Rider keys that map to Monaco commands. */
export function installRiderKeymap(runArw: (command: string, editor: monaco.editor.ICodeEditor) => void) {
  if (installed) return
  installed = true
  monaco.editor.addKeybindingRules(MONACO_CONFLICTS.map(([k, cmd]) => ({ keybinding: toMonacoKey(k), command: `-${cmd}` })))

  // Editor-local arw.* commands.
  const local: Record<string, (ed: monaco.editor.ICodeEditor) => void> = {
    'arw.pageTop': (ed) => moveToVisibleEdge(ed, 'top'),
    'arw.pageBottom': (ed) => moveToVisibleEdge(ed, 'bottom'),
    'arw.toggleCase': toggleCase
  }
  for (const [id, fn] of Object.entries(local)) {
    monaco.editor.registerCommand(id, () => { if (lastEditor) fn(lastEditor) })
  }

  const rules: monaco.editor.IKeybindingRule[] = []
  for (const b of RIDER_KEYMAP) {
    if (WINDOW_COMMANDS.has(b.command)) continue          // handled at window level
    if (b.command === 'arw.toggleBreakpoint') {
      for (const k of b.keys) rules.push({ keybinding: toMonacoKey(k), command: 'arw.toggleBreakpoint', when: 'editorTextFocus' })
      continue
    }
    for (const k of b.keys) rules.push({ keybinding: toMonacoKey(k), command: b.command, when: 'editorTextFocus' })
  }
  monaco.editor.addKeybindingRules(rules)
  monaco.editor.registerCommand('arw.toggleBreakpoint', () => { if (lastEditor) runArw('arw.toggleBreakpoint', lastEditor) })
}

let lastEditor: monaco.editor.ICodeEditor | null = null
/** The IDE window has one editor; it registers itself here so arw.* commands can find it. */
export function setActiveEditor(ed: monaco.editor.ICodeEditor | null) { lastEditor = ed }

function moveToVisibleEdge(ed: monaco.editor.ICodeEditor, edge: 'top' | 'bottom') {
  const r = ed.getVisibleRanges()[0]
  if (!r) return
  const line = edge === 'top' ? r.startLineNumber : r.endLineNumber
  const col = ed.getPosition()?.column ?? 1
  ed.setPosition({ lineNumber: line, column: col })
}

function toggleCase(ed: monaco.editor.ICodeEditor) {
  const model = ed.getModel()
  const sels = ed.getSelections()
  if (!model || !sels) return
  // Rider: all-lowercase selection -> UPPER, otherwise -> lower. Empty selection = word at caret.
  const ranges = sels.map(s => {
    if (!s.isEmpty()) return s
    const w = model.getWordAtPosition(s.getPosition())
    return w ? new monaco.Range(s.positionLineNumber, w.startColumn, s.positionLineNumber, w.endColumn) : s
  })
  const text = ranges.map(r => model.getValueInRange(r)).join('')
  const upper = text === text.toLowerCase()
  ed.executeEdits('toggleCase', ranges.map(r => {
    const t = model.getValueInRange(r)
    return { range: r, text: upper ? t.toUpperCase() : t.toLowerCase() }
  }))
}
