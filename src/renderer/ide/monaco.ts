// Monaco, without the TypeScript/CSS/HTML language services (we only need tokenizers,
// plus JSON validation for Unity's .asmdef/.json files).
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution'
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import { THEMES, type Theme } from '../themes'
import { extOf } from './paths'

;(self as any).MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker())
}

export { monaco }

export const CSHARP = 'csharp-arw'

const CS_KEYWORDS = [
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked', 'class', 'const',
  'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern',
  'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface',
  'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override',
  'params', 'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short',
  'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'virtual', 'void', 'volatile', 'while',
  // contextual
  'add', 'alias', 'and', 'async', 'await', 'by', 'descending', 'dynamic', 'equals', 'from', 'get', 'global',
  'group', 'init', 'into', 'join', 'let', 'managed', 'nameof', 'nint', 'not', 'notnull', 'nuint', 'on', 'or',
  'orderby', 'partial', 'record', 'remove', 'required', 'scoped', 'select', 'set', 'unmanaged', 'value',
  'var', 'when', 'where', 'with', 'yield'
]

/**
 * C# tokenizer approximating Rider's semantic colors without a language server:
 * `Name(` → method, `.name` → member, PascalCase → type, plus keywords/strings/numbers.
 */
const csharpLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  keywords: CS_KEYWORDS,
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.square' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' }
  ],
  tokenizer: {
    root: [
      [/^\s*#\s*\w+.*$/, 'preprocessor'],
      [/\/\/\/.*$/, 'comment.doc'],
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/\$@"|@\$"/, 'string', '@verbatimInterp'],
      [/@"/, 'string', '@verbatim'],
      [/\$"/, 'string', '@interp'],
      [/"/, 'string', '@string'],
      [/'(?:[^'\\]|\\.)*'/, 'string'],
      [/0[xX][\da-fA-F_]+[uUlL]*/, 'number'],
      [/0[bB][01_]+[uUlL]*/, 'number'],
      [/(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?[fFdDmMuUlL]*/, 'number'],
      // member access: `.Foo(` is a method call, `.foo` a field/property
      [/(\.)(\s*)(@?[A-Za-z_]\w*)(?=\s*(?:<[\w\s,.<>[\]?]*>)?\s*\()/, ['delimiter', '', 'method']],
      [/(\.)(\s*)(@?[A-Za-z_]\w*)/, ['delimiter', '', 'member']],
      // `Foo(` / `Foo<T>(` — method call or declaration (keywords like `if (` stay keywords)
      [/@?[A-Za-z_]\w*(?=\s*(?:<[\w\s,.<>[\]?]*>)?\s*\()/, { cases: { '@keywords': 'keyword', '@default': 'method' } }],
      [/@?[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '[A-Z][\\w]*': 'type', '@default': 'identifier' } }],
      [/[{}()[\]]/, '@brackets'],
      [/[;,.]/, 'delimiter'],
      [/[=><!~?:&|+\-*/^%]+/, 'operator'],
      [/\s+/, 'white']
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment']
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop']
    ],
    verbatim: [
      [/[^"]+/, 'string'],
      [/""/, 'string.escape'],
      [/"/, 'string', '@pop']
    ],
    interp: [
      [/\{\{|\}\}/, 'string.escape'],
      [/\{/, 'delimiter.bracket', '@interpExpr'],
      [/[^\\"{}]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop']
    ],
    verbatimInterp: [
      [/\{\{|\}\}|""/, 'string.escape'],
      [/\{/, 'delimiter.bracket', '@interpExpr'],
      [/[^"{}]+/, 'string'],
      [/"/, 'string', '@pop']
    ],
    interpExpr: [
      [/\}/, 'delimiter.bracket', '@pop'],
      { include: 'root' }
    ]
  }
}

let registered = false
function registerLanguages() {
  if (registered) return
  registered = true
  monaco.languages.register({ id: CSHARP, extensions: ['.cs', '.csx'], aliases: ['C#'] })
  monaco.languages.setMonarchTokensProvider(CSHARP, csharpLanguage)
  monaco.languages.setLanguageConfiguration(CSHARP, {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string', 'comment'] }, { open: "'", close: "'", notIn: ['string', 'comment'] }
    ],
    surroundingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '"', close: '"' }],
    folding: { markers: { start: /^\s*#region\b/, end: /^\s*#endregion\b/ } },
    indentationRules: { increaseIndentPattern: /^.*\{[^}"']*$/, decreaseIndentPattern: /^\s*\}/ }
  })
}

const EXT_LANG: Record<string, string> = {
  cs: CSHARP, csx: CSHARP,
  json: 'json', asmdef: 'json', asmref: 'json', inputactions: 'json', jsonc: 'json',
  shader: 'hlsl', cginc: 'hlsl', hlsl: 'hlsl', compute: 'hlsl',
  uss: 'css', uxml: 'xml', csproj: 'xml', sln: 'ini', props: 'xml', targets: 'xml',
  unity: 'yaml', prefab: 'yaml', asset: 'yaml', mat: 'yaml', meta: 'yaml', anim: 'yaml', controller: 'yaml',
  md: 'markdown', yml: 'yaml', yaml: 'yaml', ts: 'typescript', tsx: 'typescript', js: 'javascript',
  jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python', html: 'html', css: 'css',
  scss: 'scss', xml: 'xml', ps1: 'powershell', sh: 'shell', bat: 'bat', cmd: 'bat', ini: 'ini',
  toml: 'ini', txt: 'plaintext', log: 'plaintext', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
  cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp', c: 'c', lua: 'lua', sql: 'sql'
}

export function languageFor(path: string): string {
  const lang = EXT_LANG[extOf(path)]
  if (lang && (lang === CSHARP || monaco.languages.getLanguages().some(l => l.id === lang))) return lang
  // hlsl isn't a Monaco basic language — C-like coloring is close enough
  if (lang === 'hlsl') return 'cpp'
  return 'plaintext'
}

const hex = (c: string) => c.replace('#', '')

export function monacoThemeName(t: Theme) { return `arw-${t.id}` }

function defineTheme(t: Theme) {
  const e = t.editor
  monaco.editor.defineTheme(monacoThemeName(t), {
    base: t.kind === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: hex(e.foreground) },
      { token: 'identifier', foreground: hex(e.foreground) },
      { token: 'keyword', foreground: hex(e.keyword) },
      { token: 'type', foreground: hex(e.type) },
      { token: 'type.identifier', foreground: hex(e.type) },
      { token: 'method', foreground: hex(e.method) },
      { token: 'member', foreground: hex(e.member) },
      { token: 'string', foreground: hex(e.string) },
      { token: 'string.escape', foreground: hex(e.keyword) },
      { token: 'number', foreground: hex(e.number) },
      { token: 'comment', foreground: hex(e.comment), fontStyle: 'italic' },
      { token: 'comment.doc', foreground: hex(e.comment), fontStyle: 'italic' },
      { token: 'preprocessor', foreground: hex(e.preprocessor) },
      { token: 'operator', foreground: hex(e.operator) },
      { token: 'delimiter', foreground: hex(e.operator) },
      { token: 'tag', foreground: hex(e.keyword) },
      { token: 'attribute.name', foreground: hex(e.member) },
      { token: 'attribute.value', foreground: hex(e.string) },
      { token: 'string.key.json', foreground: hex(e.member) },
      { token: 'string.value.json', foreground: hex(e.string) }
    ],
    colors: {
      'editor.background': e.background,
      'editor.foreground': e.foreground,
      'editorGutter.background': e.gutter,
      'editorLineNumber.foreground': e.lineNumber,
      'editorLineNumber.activeForeground': e.lineNumberActive,
      'editorCursor.foreground': e.caret,
      'editor.lineHighlightBackground': e.caretRow,
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': e.selection,
      'editor.inactiveSelectionBackground': e.selection + (e.selection.length === 7 ? '99' : ''),
      'editorIndentGuide.background1': e.indentGuide,
      'editorIndentGuide.activeBackground1': e.indentGuideActive,
      'editor.wordHighlightBackground': e.identifierUnderCaret,
      'editor.wordHighlightStrongBackground': e.identifierUnderCaret,
      'scrollbarSlider.background': t.kind === 'dark' ? '#5A5D6355' : '#9DA0A866',
      'scrollbarSlider.hoverBackground': t.kind === 'dark' ? '#6F737A88' : '#868A9188',
      'editorWidget.background': t.ui['--bg-raised'],
      'editorWidget.border': t.ui['--border-strong'],
      'editorHoverWidget.background': t.ui['--bg-raised'],
      'editorHoverWidget.border': t.ui['--border-strong'],
      'editorSuggestWidget.background': t.ui['--bg-raised'],
      'editorCodeLens.foreground': e.comment,
      'editorInlayHint.foreground': e.comment,
      'editorInlayHint.background': t.kind === 'dark' ? '#FFFFFF0D' : '#0000000A',
      'editorInlayHint.parameterForeground': e.comment,
      'editorInlayHint.parameterBackground': t.kind === 'dark' ? '#FFFFFF0D' : '#0000000A',
      'minimap.background': e.background
    }
  })
}

let setUp = false
/** Register languages + all themes once. */
export function ensureMonaco() {
  if (setUp) return
  setUp = true
  registerLanguages()
  THEMES.forEach(defineTheme)
}
