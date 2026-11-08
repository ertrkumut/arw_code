import { monaco } from './monaco'

/**
 * IDE actions and their key bindings.
 *
 * Defaults come from the user's Rider keymap:
 *   %APPDATA%/JetBrains/Rider2025.3/keymaps/"IntelliJ copy.xml"  (active keymap, parent "$default")
 * Actions the user customized there keep their custom keys (`custom: true`); everything else
 * uses Rider's IntelliJ "$default" keymap. Every binding can be changed in Settings › Keymap;
 * changes are stored as per-action overrides in the IDE state.
 *
 * Keys are written the way Rider's keymap XML writes them ("ctrl shift SLASH"); a second
 * stroke after a comma is a chord ("ctrl M, S"). "DOUBLE_SHIFT" is Search Everywhere's
 * double-tap of Shift.
 *
 * `command` is a Monaco command id, or an `arw.*` command implemented in ide/commands.ts.
 * `window` actions work anywhere in the IDE window; the rest only while the editor has focus.
 */
export interface ActionDef {
  id: string
  name: string
  category: Category
  command: string
  keys: string[]
  custom?: boolean
  window?: boolean
}

export type Category = 'Editing' | 'Navigation' | 'Search' | 'Code' | 'Refactoring' | 'Folding' | 'Caret' | 'Debug' | 'Tool Windows' | 'Files'

export const ACTIONS: ActionDef[] = [
  // ---- user's customizations ("IntelliJ copy") ----
  { id: 'CloseContent', name: 'Close Tab', category: 'Files', keys: ['ctrl W'], command: 'arw.closeTab', custom: true, window: true },
  { id: 'CollapseRegion', name: 'Collapse', category: 'Folding', keys: ['ctrl M, S'], command: 'editor.fold', custom: true },
  { id: 'ExpandRegion', name: 'Expand', category: 'Folding', keys: ['ctrl M, E'], command: 'editor.unfold', custom: true },
  { id: 'CommentByLineComment', name: 'Comment with Line Comment', category: 'Editing', keys: ['ctrl shift SLASH'], command: 'editor.action.commentLine', custom: true },
  { id: 'EditorLineStart', name: 'Move Caret to Line Start', category: 'Caret', keys: ['ctrl LEFT', 'HOME'], command: 'cursorHome', custom: true },
  { id: 'EditorLineEnd', name: 'Move Caret to Line End', category: 'Caret', keys: ['ctrl RIGHT', 'END'], command: 'cursorEnd', custom: true },
  { id: 'EditorLineStartWithSelection', name: 'Move Caret to Line Start with Selection', category: 'Caret', keys: ['ctrl shift LEFT', 'shift HOME'], command: 'cursorHomeSelect', custom: true },
  { id: 'EditorLineEndWithSelection', name: 'Move Caret to Line End with Selection', category: 'Caret', keys: ['ctrl shift RIGHT', 'shift END'], command: 'cursorEndSelect', custom: true },
  { id: 'EditorMoveToPageTop', name: 'Move Caret to Page Top', category: 'Caret', keys: ['ctrl UP'], command: 'arw.pageTop', custom: true },
  { id: 'EditorMoveToPageBottom', name: 'Move Caret to Page Bottom', category: 'Caret', keys: ['ctrl DOWN'], command: 'arw.pageBottom', custom: true },
  { id: 'EditorNextWord', name: 'Move Caret to Next Word', category: 'Caret', keys: ['alt RIGHT'], command: 'cursorWordEndRight', custom: true },
  { id: 'EditorPreviousWord', name: 'Move Caret to Previous Word', category: 'Caret', keys: ['alt LEFT'], command: 'cursorWordStartLeft', custom: true },
  { id: 'EditorNextWordWithSelection', name: 'Move Caret to Next Word with Selection', category: 'Caret', keys: ['alt shift RIGHT'], command: 'cursorWordEndRightSelect', custom: true },
  { id: 'EditorPreviousWordWithSelection', name: 'Move Caret to Previous Word with Selection', category: 'Caret', keys: ['alt shift LEFT'], command: 'cursorWordStartLeftSelect', custom: true },
  { id: 'GotoClass', name: 'Go to Class…', category: 'Navigation', keys: ['ctrl P'], command: 'arw.gotoClass', custom: true, window: true },
  { id: 'RenameElement', name: 'Rename…', category: 'Refactoring', keys: ['ctrl R', 'shift F6'], command: 'arw.rename', custom: true },
  { id: 'SelectNextOccurrence', name: 'Add Selection for Next Occurrence', category: 'Caret', keys: ['ctrl E'], command: 'editor.action.addSelectionToNextFindMatch', custom: true },

  // ---- navigation (Rider "$default") ----
  { id: 'GotoDeclaration', name: 'Go to Declaration or Usages', category: 'Navigation', keys: ['ctrl B'], command: 'arw.gotoDeclaration' },
  { id: 'GotoImplementation', name: 'Go to Implementation(s)', category: 'Navigation', keys: ['ctrl alt B'], command: 'arw.gotoImplementation' },
  { id: 'GotoSuperMethod', name: 'Go to Base Symbols', category: 'Navigation', keys: ['ctrl U'], command: 'arw.gotoSuper' },
  { id: 'GotoTypeDeclaration', name: 'Go to Type Declaration', category: 'Navigation', keys: ['ctrl shift B'], command: 'arw.gotoTypeDeclaration' },
  { id: 'SearchEverywhere', name: 'Search Everywhere', category: 'Navigation', keys: ['DOUBLE_SHIFT'], command: 'arw.searchEverywhere', window: true },
  { id: 'GotoFile', name: 'Go to File…', category: 'Navigation', keys: ['ctrl shift N'], command: 'arw.gotoFile', window: true },
  { id: 'GotoSymbol', name: 'Go to Symbol…', category: 'Navigation', keys: ['ctrl alt shift N'], command: 'arw.gotoSymbol', window: true },
  { id: 'GotoAction', name: 'Find Action…', category: 'Navigation', keys: ['ctrl shift A'], command: 'arw.findAction', window: true },
  { id: 'FileStructurePopup', name: 'File Structure', category: 'Navigation', keys: ['ctrl F12'], command: 'arw.fileStructure', window: true },
  { id: 'RecentFiles', name: 'Recent Files', category: 'Navigation', keys: ['ctrl shift E'], command: 'arw.recentFiles', window: true },
  { id: 'Switcher', name: 'Switcher', category: 'Navigation', keys: ['ctrl TAB'], command: 'arw.switcher', window: true },
  { id: 'Back', name: 'Back', category: 'Navigation', keys: ['ctrl alt LEFT'], command: 'arw.back', window: true },
  { id: 'Forward', name: 'Forward', category: 'Navigation', keys: ['ctrl alt RIGHT'], command: 'arw.forward', window: true },
  { id: 'MethodDown', name: 'Next Method', category: 'Navigation', keys: ['alt DOWN'], command: 'arw.nextMethod' },
  { id: 'MethodUp', name: 'Previous Method', category: 'Navigation', keys: ['alt UP'], command: 'arw.prevMethod' },
  { id: 'GotoLine', name: 'Go to Line:Column…', category: 'Navigation', keys: ['ctrl G'], command: 'editor.action.gotoLine' },
  { id: 'EditorMatchBrace', name: 'Move Caret to Matching Brace', category: 'Navigation', keys: ['ctrl shift M'], command: 'editor.action.jumpToBracket' },
  { id: 'ToggleBookmark', name: 'Toggle Bookmark', category: 'Navigation', keys: ['F11'], command: 'arw.toggleBookmark' },
  { id: 'ShowBookmarks', name: 'Show Bookmarks', category: 'Navigation', keys: ['shift F11'], command: 'arw.showBookmarks', window: true },
  { id: 'SelectInProjectView', name: 'Select Opened File in Project', category: 'Navigation', keys: ['alt F1'], command: 'arw.selectInTree', window: true },
  { id: 'ReopenClosedTab', name: 'Reopen Closed Tab', category: 'Files', keys: ['ctrl shift T'], command: 'arw.reopenClosedTab', window: true },

  // ---- search ----
  { id: 'FindUsages', name: 'Find Usages', category: 'Search', keys: ['alt F7'], command: 'arw.findUsages' },
  { id: 'ShowUsages', name: 'Show Usages', category: 'Search', keys: ['ctrl alt F7'], command: 'arw.showUsages' },
  { id: 'HighlightUsagesInFile', name: 'Highlight Usages in File', category: 'Search', keys: ['ctrl shift F7'], command: 'editor.action.wordHighlight.trigger' },
  { id: 'Find', name: 'Find', category: 'Search', keys: ['ctrl F', 'alt F3'], command: 'actions.find' },
  { id: 'Replace', name: 'Replace', category: 'Search', keys: ['ctrl H'], command: 'editor.action.startFindReplaceAction' },
  { id: 'FindNext', name: 'Find Next', category: 'Search', keys: ['F3', 'ctrl L'], command: 'editor.action.nextMatchFindAction' },
  { id: 'FindPrevious', name: 'Find Previous', category: 'Search', keys: ['shift F3', 'ctrl shift L'], command: 'editor.action.previousMatchFindAction' },
  { id: 'FindInPath', name: 'Find in Files…', category: 'Search', keys: ['ctrl shift F'], command: 'arw.findInFiles', window: true },
  { id: 'ReplaceInPath', name: 'Replace in Files…', category: 'Search', keys: ['ctrl shift R'], command: 'arw.replaceInFiles', window: true },

  // ---- code insight ----
  { id: 'QuickJavaDoc', name: 'Quick Documentation', category: 'Code', keys: ['ctrl Q'], command: 'editor.action.showHover' },
  { id: 'ParameterInfo', name: 'Parameter Info', category: 'Code', keys: ['ctrl shift SPACE'], command: 'editor.action.triggerParameterHints' },
  { id: 'CodeCompletion', name: 'Basic Completion', category: 'Code', keys: ['ctrl SPACE'], command: 'editor.action.triggerSuggest' },
  { id: 'InsertLiveTemplate', name: 'Insert Live Template…', category: 'Code', keys: ['ctrl J'], command: 'arw.liveTemplates' },
  { id: 'SurroundWith', name: 'Surround With…', category: 'Code', keys: ['ctrl alt T'], command: 'arw.surroundWith' },
  { id: 'Generate', name: 'Generate…', category: 'Code', keys: ['alt INSERT'], command: 'arw.generate' },
  { id: 'ShowIntentionActions', name: 'Show Context Actions', category: 'Code', keys: ['alt ENTER'], command: 'editor.action.quickFix' },
  { id: 'ReformatCode', name: 'Reformat Code', category: 'Code', keys: ['ctrl alt L'], command: 'editor.action.formatDocument' },
  { id: 'CopyReference', name: 'Copy Reference', category: 'Code', keys: ['ctrl alt shift C'], command: 'arw.copyReference' },
  { id: 'ToggleInlayHints', name: 'Toggle Parameter Name Hints', category: 'Code', keys: [], command: 'arw.toggleInlayHints' },
  { id: 'ToggleCodeVision', name: 'Toggle Code Vision', category: 'Code', keys: [], command: 'arw.toggleCodeVision' },

  // ---- editing ----
  { id: 'SaveAll', name: 'Save All', category: 'Files', keys: ['ctrl S'], command: 'arw.saveAll', window: true },
  { id: 'EditorDuplicate', name: 'Duplicate Line or Selection', category: 'Editing', keys: ['ctrl D'], command: 'editor.action.copyLinesDownAction' },
  { id: 'EditorDeleteLine', name: 'Delete Line', category: 'Editing', keys: ['ctrl Y'], command: 'editor.action.deleteLines' },
  { id: 'MoveLineUp', name: 'Move Line Up', category: 'Editing', keys: ['alt shift UP'], command: 'editor.action.moveLinesUpAction' },
  { id: 'MoveLineDown', name: 'Move Line Down', category: 'Editing', keys: ['alt shift DOWN'], command: 'editor.action.moveLinesDownAction' },
  { id: 'MoveStatementUp', name: 'Move Statement Up', category: 'Editing', keys: ['ctrl shift UP'], command: 'editor.action.moveLinesUpAction' },
  { id: 'MoveStatementDown', name: 'Move Statement Down', category: 'Editing', keys: ['ctrl shift DOWN'], command: 'editor.action.moveLinesDownAction' },
  { id: 'EditorSelectWord', name: 'Extend Selection', category: 'Caret', keys: [], command: 'editor.action.smartSelect.expand' },
  { id: 'EditorUnSelectWord', name: 'Shrink Selection', category: 'Caret', keys: ['ctrl shift W'], command: 'editor.action.smartSelect.shrink' },
  { id: 'UnselectPreviousOccurrence', name: 'Unselect Occurrence', category: 'Caret', keys: ['alt shift J'], command: 'cursorUndo' },
  { id: 'SelectAllOccurrences', name: 'Select All Occurrences', category: 'Caret', keys: ['ctrl alt shift J'], command: 'editor.action.selectHighlights' },
  { id: 'EditorStartNewLine', name: 'Start New Line', category: 'Editing', keys: ['shift ENTER'], command: 'editor.action.insertLineAfter' },
  { id: 'EditorStartNewLineBefore', name: 'Start New Line Before Current', category: 'Editing', keys: ['ctrl alt ENTER'], command: 'editor.action.insertLineBefore' },
  { id: 'EditorJoinLines', name: 'Join Lines', category: 'Editing', keys: ['ctrl shift J'], command: 'editor.action.joinLines' },
  { id: 'EditorToggleCase', name: 'Toggle Case', category: 'Editing', keys: ['ctrl shift U'], command: 'arw.toggleCase' },
  { id: '$Undo', name: 'Undo', category: 'Editing', keys: ['ctrl Z', 'alt BACK_SPACE'], command: 'undo' },
  { id: '$Redo', name: 'Redo', category: 'Editing', keys: ['ctrl shift Z', 'alt shift BACK_SPACE'], command: 'redo' },
  { id: 'EditorTextStart', name: 'Move Caret to Text Start', category: 'Caret', keys: ['ctrl HOME'], command: 'cursorTop' },
  { id: 'EditorTextEnd', name: 'Move Caret to Text End', category: 'Caret', keys: ['ctrl END'], command: 'cursorBottom' },
  { id: 'EditorDeleteToWordStart', name: 'Delete to Word Start', category: 'Editing', keys: ['ctrl BACK_SPACE'], command: 'deleteWordLeft' },
  { id: 'EditorDeleteToWordEnd', name: 'Delete to Word End', category: 'Editing', keys: ['ctrl DELETE'], command: 'deleteWordRight' },
  { id: 'EditorAddCaretPerSelectedLine', name: 'Add Carets to Ends of Selected Lines', category: 'Caret', keys: ['alt shift G'], command: 'editor.action.insertCursorAtEndOfEachLineSelected' },

  // ---- folding ----
  { id: 'ExpandAllRegions', name: 'Expand All', category: 'Folding', keys: ['ctrl shift ADD', 'ctrl shift EQUALS'], command: 'editor.unfoldAll' },
  { id: 'CollapseAllRegions', name: 'Collapse All', category: 'Folding', keys: ['ctrl shift SUBTRACT', 'ctrl shift MINUS'], command: 'editor.foldAll' },
  { id: 'ExpandRegionRecursively', name: 'Expand Recursively', category: 'Folding', keys: ['ctrl alt ADD', 'ctrl alt EQUALS'], command: 'editor.unfoldRecursively' },
  { id: 'CollapseRegionRecursively', name: 'Collapse Recursively', category: 'Folding', keys: ['ctrl alt SUBTRACT', 'ctrl alt MINUS'], command: 'editor.foldRecursively' },

  // ---- debugger ----
  { id: 'ToggleLineBreakpoint', name: 'Toggle Line Breakpoint', category: 'Debug', keys: ['ctrl F8'], command: 'arw.toggleBreakpoint' },
  { id: 'Debug', name: 'Attach to Unity / Debug', category: 'Debug', keys: ['shift F9'], command: 'arw.debug', window: true },
  { id: 'Resume', name: 'Resume Program', category: 'Debug', keys: ['F9'], command: 'arw.resume', window: true },
  { id: 'StepOver', name: 'Step Over', category: 'Debug', keys: ['F8'], command: 'arw.stepOver', window: true },
  { id: 'StepInto', name: 'Step Into', category: 'Debug', keys: ['F7'], command: 'arw.stepInto', window: true },
  { id: 'StepOut', name: 'Step Out', category: 'Debug', keys: ['shift F8'], command: 'arw.stepOut', window: true },
  { id: 'Stop', name: 'Stop', category: 'Debug', keys: ['ctrl F2'], command: 'arw.stop', window: true },

  // ---- tool windows ----
  { id: 'ActivateProjectToolWindow', name: 'Project', category: 'Tool Windows', keys: ['alt 1'], command: 'arw.toggleTree', window: true },
  { id: 'ActivateFindToolWindow', name: 'Find', category: 'Tool Windows', keys: ['alt 3'], command: 'arw.toggleFind', window: true },
  { id: 'ActivateDebugToolWindow', name: 'Debug', category: 'Tool Windows', keys: ['alt 5'], command: 'arw.toggleDebug', window: true },
  { id: 'HideAllWindows', name: 'Hide All Tool Windows', category: 'Tool Windows', keys: ['ctrl shift F12'], command: 'arw.hideAll', window: true },
  { id: 'ShowSettings', name: 'Settings…', category: 'Tool Windows', keys: ['ctrl alt S'], command: 'arw.settings', window: true },
  { id: 'ShowKeymap', name: 'Keymap…', category: 'Tool Windows', keys: [], command: 'arw.keymap', window: true }
]

export const ACTION_BY_ID = new Map(ACTIONS.map(a => [a.id, a]))

// ---------------------------------------------------------------------------------------
// Effective keymap (defaults + the user's overrides)
// ---------------------------------------------------------------------------------------

let overrides: Record<string, string[]> = {}
const listeners = new Set<() => void>()

export function setKeymapOverrides(o: Record<string, string[]> | undefined) {
  const next = o ?? {}
  if (JSON.stringify(next) === JSON.stringify(overrides)) return
  overrides = next
  installEditorBindings()
  listeners.forEach(f => f())
}
export function onKeymapChanged(f: () => void) { listeners.add(f); return () => { listeners.delete(f) } }

export function keysFor(actionId: string): string[] {
  return overrides[actionId] ?? ACTION_BY_ID.get(actionId)?.keys ?? []
}
export const isOverridden = (actionId: string) => actionId in overrides

/** First binding of a command, formatted for tooltips: "Ctrl+B". */
export function shortcutLabel(actionId: string): string {
  const k = keysFor(actionId)[0]
  return k ? formatKeys(k) : ''
}

// ---------------------------------------------------------------------------------------
// Key specs
// ---------------------------------------------------------------------------------------

/** Rider key name → KeyboardEvent.code */
const CODE: Record<string, string> = {
  LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', UP: 'ArrowUp', DOWN: 'ArrowDown', HOME: 'Home', END: 'End',
  PAGE_UP: 'PageUp', PAGE_DOWN: 'PageDown', ENTER: 'Enter', TAB: 'Tab', SPACE: 'Space', ESCAPE: 'Escape',
  BACK_SPACE: 'Backspace', DELETE: 'Delete', INSERT: 'Insert', SLASH: 'Slash', BACK_SLASH: 'Backslash',
  MINUS: 'Minus', EQUALS: 'Equal', COMMA: 'Comma', PERIOD: 'Period', SEMICOLON: 'Semicolon', QUOTE: 'Quote',
  BACK_QUOTE: 'Backquote', OPEN_BRACKET: 'BracketLeft', CLOSE_BRACKET: 'BracketRight',
  ADD: 'NumpadAdd', SUBTRACT: 'NumpadSubtract', DIVIDE: 'NumpadDivide', MULTIPLY: 'NumpadMultiply'
}
const NAME_OF_CODE: Record<string, string> = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]))
NAME_OF_CODE.NumpadEnter = 'ENTER'

const PRETTY: Record<string, string> = {
  LEFT: '←', RIGHT: '→', UP: '↑', DOWN: '↓', PAGE_UP: 'Page Up', PAGE_DOWN: 'Page Down', BACK_SPACE: 'Backspace',
  SLASH: '/', BACK_SLASH: '\\', MINUS: '-', EQUALS: '=', COMMA: ',', PERIOD: '.', SEMICOLON: ';', QUOTE: "'",
  BACK_QUOTE: '`', OPEN_BRACKET: '[', CLOSE_BRACKET: ']', ADD: 'Num +', SUBTRACT: 'Num -', DIVIDE: 'Num /',
  MULTIPLY: 'Num *', ESCAPE: 'Esc', ENTER: 'Enter', TAB: 'Tab', SPACE: 'Space', DELETE: 'Delete', INSERT: 'Insert',
  HOME: 'Home', END: 'End'
}

interface Stroke { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string }

function parseStroke(s: string): Stroke {
  const st: Stroke = { ctrl: false, alt: false, shift: false, meta: false, key: '' }
  for (const part of s.trim().split(/\s+/)) {
    const p = part.toLowerCase()
    if (p === 'ctrl' || p === 'control') st.ctrl = true
    else if (p === 'alt') st.alt = true
    else if (p === 'shift') st.shift = true
    else if (p === 'meta') st.meta = true
    else st.key = part.toUpperCase()
  }
  return st
}

const strokeToString = (s: Stroke) => [s.ctrl && 'ctrl', s.alt && 'alt', s.shift && 'shift', s.meta && 'meta', s.key].filter(Boolean).join(' ')

/** Canonical spelling so "shift ctrl n" equals "ctrl shift N". */
export function normalizeKeys(spec: string): string {
  if (spec === 'DOUBLE_SHIFT') return spec
  return spec.split(',').map(s => strokeToString(parseStroke(s))).join(', ')
}

/** "ctrl shift N" → "Ctrl+Shift+N"; chords "Ctrl+M, S". */
export function formatKeys(spec: string): string {
  if (spec === 'DOUBLE_SHIFT') return 'Double Shift'
  return spec.split(',').map(s => {
    const st = parseStroke(s)
    const parts = [st.ctrl && 'Ctrl', st.alt && 'Alt', st.shift && 'Shift', st.meta && 'Win'].filter(Boolean) as string[]
    const k = st.key
    parts.push(PRETTY[k] ?? (k.length === 1 ? k : k.charAt(0) + k.slice(1).toLowerCase()))
    return parts.join('+')
  }).join(', ')
}

/** KeyboardEvent → "ctrl shift N" (null for a bare modifier press). */
export function eventToStroke(e: { code: string; key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  const code = e.code
  if (/^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(code) || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  let key: string | undefined
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit\d$/.test(code)) key = code.slice(5)
  else if (/^Numpad\d$/.test(code)) key = code.slice(6)
  else if (/^F\d{1,2}$/.test(code)) key = code
  else key = NAME_OF_CODE[code]
  if (!key) return null
  return strokeToString({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key })
}

/** Actions (other than `except`) already using a key spec. */
export function conflictsFor(spec: string, except?: string): ActionDef[] {
  const n = normalizeKeys(spec)
  return ACTIONS.filter(a => a.id !== except && keysFor(a.id).some(k => normalizeKeys(k) === n))
}

// ---------------------------------------------------------------------------------------
// Monaco bindings
// ---------------------------------------------------------------------------------------

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
  ['F12', 'editor.action.revealDefinition'],
  ['ctrl F12', 'editor.action.goToImplementation'],
  ['shift F12', 'editor.action.goToReferences'],
  ['alt F12', 'editor.action.peekDefinition'],
  ['ctrl shift O', 'editor.action.quickOutline'],
  ['ctrl U', 'cursorUndo'],
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
  ['shift alt LEFT', 'editor.action.smartSelect.shrink'],
  ['F1', 'editor.action.quickCommand'],
  ['ctrl shift F', 'editor.action.formatDocument'],
  ['shift alt F', 'editor.action.formatDocument']
]

const KEYS: Record<string, number> = {
  LEFT: monaco.KeyCode.LeftArrow, RIGHT: monaco.KeyCode.RightArrow, UP: monaco.KeyCode.UpArrow, DOWN: monaco.KeyCode.DownArrow,
  HOME: monaco.KeyCode.Home, END: monaco.KeyCode.End, PAGE_UP: monaco.KeyCode.PageUp, PAGE_DOWN: monaco.KeyCode.PageDown,
  ENTER: monaco.KeyCode.Enter, TAB: monaco.KeyCode.Tab, SPACE: monaco.KeyCode.Space, ESCAPE: monaco.KeyCode.Escape,
  BACK_SPACE: monaco.KeyCode.Backspace, DELETE: monaco.KeyCode.Delete, INSERT: monaco.KeyCode.Insert,
  SLASH: monaco.KeyCode.Slash, BACK_SLASH: monaco.KeyCode.Backslash, MINUS: monaco.KeyCode.Minus, EQUALS: monaco.KeyCode.Equal,
  COMMA: monaco.KeyCode.Comma, PERIOD: monaco.KeyCode.Period, SEMICOLON: monaco.KeyCode.Semicolon, QUOTE: monaco.KeyCode.Quote,
  BACK_QUOTE: monaco.KeyCode.Backquote, OPEN_BRACKET: monaco.KeyCode.BracketLeft, CLOSE_BRACKET: monaco.KeyCode.BracketRight,
  ADD: monaco.KeyCode.NumpadAdd, SUBTRACT: monaco.KeyCode.NumpadSubtract, DIVIDE: monaco.KeyCode.NumpadDivide,
  MULTIPLY: monaco.KeyCode.NumpadMultiply
}

/** "ctrl shift SLASH" -> Monaco keybinding number (0 if the key is unknown). */
function stroke(s: string): number {
  const st = parseStroke(s)
  let mods = 0
  if (st.ctrl) mods |= monaco.KeyMod.CtrlCmd
  if (st.shift) mods |= monaco.KeyMod.Shift
  if (st.alt) mods |= monaco.KeyMod.Alt
  if (st.meta) mods |= monaco.KeyMod.WinCtrl
  const u = st.key
  const key = KEYS[u]
    ?? (/^F\d{1,2}$/.test(u) ? (monaco.KeyCode as any)[u]
    : /^[A-Z]$/.test(u) ? (monaco.KeyCode as any)[`Key${u}`]
    : /^\d$/.test(u) ? (monaco.KeyCode as any)[`Digit${u}`] : 0)
  return key ? mods | key : 0
}

export function toMonacoKey(spec: string): number {
  const [a, b] = spec.split(',')
  const x = stroke(a)
  if (!x) return 0
  if (!b) return x
  const y = stroke(b)
  return y ? monaco.KeyMod.chord(x, y) : 0
}

let conflictsRemoved = false
let editorRules: monaco.IDisposable | null = null
const registered = new Set<string>()
let runCommand: ((command: string) => void) | null = null

/** Bind every editor-scope action through Monaco (re-run whenever the keymap changes). */
function installEditorBindings() {
  if (!runCommand) return
  if (!conflictsRemoved) {
    conflictsRemoved = true
    monaco.editor.addKeybindingRules(MONACO_CONFLICTS.map(([k, cmd]) => ({ keybinding: toMonacoKey(k), command: `-${cmd}` })))
  }
  editorRules?.dispose()
  const rules: monaco.editor.IKeybindingRule[] = []
  for (const a of ACTIONS) {
    if (a.window) continue
    if (a.command.startsWith('arw.') && !registered.has(a.command)) {
      registered.add(a.command)
      const id = a.command
      monaco.editor.registerCommand(id, () => runCommand?.(id))
    }
    for (const k of keysFor(a.id)) {
      const kb = k === 'DOUBLE_SHIFT' ? 0 : toMonacoKey(k)
      if (kb) rules.push({ keybinding: kb, command: a.command, when: 'editorTextFocus' })
    }
  }
  editorRules = monaco.editor.addKeybindingRules(rules)
}

/** Called once by the editor: `run` executes arw.* commands (see ide/commands.ts). */
export function installKeymap(run: (command: string) => void) {
  if (runCommand) return
  runCommand = run
  installEditorBindings()
}

// ---------------------------------------------------------------------------------------
// Window-level dispatcher (keys that work anywhere in the IDE window)
// ---------------------------------------------------------------------------------------

/**
 * Creates a keydown/keyup handler pair that matches window-scope actions, including
 * two-stroke chords and double-Shift. `run` returns true when it handled the command.
 */
export function createWindowKeyHandler(run: (command: string) => boolean, blocked: () => boolean) {
  let chordFirst: string | null = null
  let chordTimer: number | undefined
  let lastShiftUp = 0
  let otherKeySinceShift = false

  const windowActions = () => ACTIONS.filter(a => a.window)

  const keydown = (e: KeyboardEvent) => {
    if (e.key !== 'Shift') otherKeySinceShift = true
    else if (!e.repeat) otherKeySinceShift = false   // only keys pressed while/after Shift count
    if (blocked()) return
    const st = eventToStroke(e)
    if (!st) return
    if (chordFirst) {
      const full = `${chordFirst}, ${st}`
      chordFirst = null
      clearTimeout(chordTimer)
      const hit = windowActions().find(a => keysFor(a.id).some(k => normalizeKeys(k) === full))
      if (hit && run(hit.command)) { e.preventDefault(); e.stopImmediatePropagation() }
      return
    }
    const actions = windowActions()
    const hit = actions.find(a => keysFor(a.id).some(k => normalizeKeys(k) === st))
    if (hit && run(hit.command)) { e.preventDefault(); e.stopImmediatePropagation(); return }
    const startsChord = actions.some(a => keysFor(a.id).some(k => k.includes(',') && normalizeKeys(k).startsWith(st + ',')))
    if (startsChord) {
      chordFirst = st
      chordTimer = window.setTimeout(() => { chordFirst = null }, 1500)
      e.preventDefault(); e.stopImmediatePropagation()
    }
  }

  const keyup = (e: KeyboardEvent) => {
    if (e.key !== 'Shift') return
    const now = Date.now()
    if (!otherKeySinceShift && now - lastShiftUp < 350 && !blocked()) {
      const hit = windowActions().find(a => keysFor(a.id).includes('DOUBLE_SHIFT'))
      if (hit) run(hit.command)
      lastShiftUp = 0
    } else lastShiftUp = otherKeySinceShift ? 0 : now
    otherKeySinceShift = false
  }

  return { keydown, keyup }
}
