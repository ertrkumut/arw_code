/**
 * App themes. A theme drives three things at once:
 *  - `ui`: the CSS custom properties every component reads (global.css :root names)
 *  - `editor`: Monaco colors + C# token colors (Rider color-scheme semantics)
 *  - `terminal`: the xterm palette
 *
 * Adding a theme = adding an entry to THEMES. "Rider Dark" / "Rider Light" editor colors
 * are taken from Rider's bundled color schemes (rider-theme-pack: RiderDark.xml /
 * RiderLight.xml); the chrome grays come from the IntelliJ New UI dark/light themes.
 */

export interface TerminalPalette {
  background: string; foreground: string; cursor: string; selection: string
  black: string; red: string; green: string; yellow: string; blue: string; magenta: string; cyan: string; white: string
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string
}

export interface EditorPalette {
  background: string; foreground: string; gutter: string; lineNumber: string; lineNumberActive: string
  caret: string; caretRow: string; selection: string; indentGuide: string; indentGuideActive: string
  identifierUnderCaret: string; breakpointLine: string; executionLine: string
  // syntax
  keyword: string; string: string; number: string; comment: string; type: string; struct: string
  method: string; member: string; constant: string; attribute: string; preprocessor: string; operator: string
}

export interface Theme {
  id: string
  name: string
  kind: 'dark' | 'light'
  ui: Record<string, string>
  editor: EditorPalette
  terminal: TerminalPalette
}

const oceanicUi = {
  '--bg-base': '#0E1016', '--bg-sidebar': '#13151D', '--bg-raised': '#171A24', '--bg-card': '#161922',
  '--bg-card-hover': '#1B1F2B', '--bg-card-active': '#1E2333', '--bg-terminal': '#0D0F15',
  '--border': '#21252F', '--border-strong': '#2C313F',
  '--text-primary': '#E7EAF3', '--text-secondary': '#A6ADC0', '--text-muted': '#69708A', '--text-faint': '#474E63',
  '--accent': '#5BC9C0', '--accent-dim': '#3C8F89', '--accent-soft': 'rgba(91,201,192,0.12)', '--accent-glow': 'rgba(91,201,192,0.30)',
  '--error': '#EB6F77', '--hover-overlay': 'rgba(255,255,255,.06)', '--shadow': 'rgba(0,0,0,.40)'
}

const darkAnsi = {
  black: '#1A1D27', red: '#EB6F77', green: '#7FD88F', yellow: '#F2C57C', blue: '#82AAFF', magenta: '#C792EA',
  cyan: '#5BC9C0', white: '#C8CEDE', brightBlack: '#474E63', brightRed: '#FF8B92', brightGreen: '#9BE5A8',
  brightYellow: '#FFD89B', brightBlue: '#9CC0FF', brightMagenta: '#DDB0F6', brightCyan: '#7FE0D8', brightWhite: '#E7EAF3'
}

// Rider Dark color scheme (RiderDark.xml) syntax colors.
const riderDarkSyntax = {
  keyword: '#6C95EB', string: '#C9A26D', number: '#ED94C0', comment: '#85C46C', type: '#C191FF', struct: '#E1BFFF',
  method: '#39CC9B', member: '#66C3CC', constant: '#66C3CC', attribute: '#C191FF', preprocessor: '#787878', operator: '#BDBDBD'
}

export const THEMES: Theme[] = [
  {
    id: 'rider-dark', name: 'Rider Dark', kind: 'dark',
    ui: {
      '--bg-base': '#1E1F22', '--bg-sidebar': '#2B2D30', '--bg-raised': '#2B2D30', '--bg-card': '#313338',
      '--bg-card-hover': '#393B40', '--bg-card-active': '#2E436E', '--bg-terminal': '#1E1F22',
      '--border': '#1E1F22', '--border-strong': '#43454A',
      '--text-primary': '#DFE1E5', '--text-secondary': '#CED0D6', '--text-muted': '#868A91', '--text-faint': '#6F737A',
      '--accent': '#548AF7', '--accent-dim': '#3574F0', '--accent-soft': 'rgba(53,116,240,0.18)', '--accent-glow': 'rgba(53,116,240,0.35)',
      '--error': '#DB5C5C', '--hover-overlay': 'rgba(255,255,255,.07)', '--shadow': 'rgba(0,0,0,.45)'
    },
    editor: {
      background: '#262626', foreground: '#D0D0D0', gutter: '#282828', lineNumber: '#808080', lineNumberActive: '#C8C8C8',
      caret: '#F0F0F0', caretRow: '#202424', selection: '#08335E', indentGuide: '#404040', indentGuideActive: '#666666',
      identifierUnderCaret: '#232E46', breakpointLine: '#4A2421', executionLine: '#6B4C1B',
      ...riderDarkSyntax
    },
    terminal: { background: '#1E1F22', foreground: '#CED0D6', cursor: '#CED0D6', selection: 'rgba(33,66,131,0.6)', ...darkAnsi, cyan: '#2AACB8', blue: '#548AF7' }
  },
  {
    id: 'oceanic', name: 'Oceanic', kind: 'dark',
    ui: oceanicUi,
    editor: {
      background: '#0D0F15', foreground: '#C8CEDE', gutter: '#0D0F15', lineNumber: '#474E63', lineNumberActive: '#A6ADC0',
      caret: '#5BC9C0', caretRow: '#141822', selection: '#5BC9C038', indentGuide: '#1E222D', indentGuideActive: '#2C313F',
      identifierUnderCaret: '#1C2B33', breakpointLine: '#3A1E24', executionLine: '#4A3A1A',
      keyword: '#C792EA', string: '#C3E88D', number: '#F78C6C', comment: '#546E7A', type: '#FFCB6B', struct: '#FFCB6B',
      method: '#82AAFF', member: '#5BC9C0', constant: '#F78C6C', attribute: '#FFCB6B', preprocessor: '#69708A', operator: '#89DDFF'
    },
    terminal: { background: '#0D0F15', foreground: '#C8CEDE', cursor: '#5BC9C0', selection: 'rgba(91,201,192,0.22)', ...darkAnsi }
  },
  {
    id: 'rider-light', name: 'Rider Light', kind: 'light',
    ui: {
      '--bg-base': '#F7F8FA', '--bg-sidebar': '#EBECF0', '--bg-raised': '#FFFFFF', '--bg-card': '#FFFFFF',
      '--bg-card-hover': '#DFE1E5', '--bg-card-active': '#D4E2FF', '--bg-terminal': '#FFFFFF',
      '--border': '#DFE1E5', '--border-strong': '#C9CCD6',
      '--text-primary': '#000000', '--text-secondary': '#2B2D30', '--text-muted': '#6C707E', '--text-faint': '#A8ADBD',
      '--accent': '#3574F0', '--accent-dim': '#2E55A3', '--accent-soft': 'rgba(53,116,240,0.12)', '--accent-glow': 'rgba(53,116,240,0.25)',
      '--error': '#E55765', '--hover-overlay': 'rgba(0,0,0,.05)', '--shadow': 'rgba(0,0,0,.15)'
    },
    editor: {
      background: '#FFFFFF', foreground: '#202020', gutter: '#FFFFFF', lineNumber: '#888888', lineNumberActive: '#202020',
      caret: '#000000', caretRow: '#F4F8F8', selection: '#B8D9FF', indentGuide: '#D8D8D8', indentGuideActive: '#9F9F9F',
      identifierUnderCaret: '#EDEBFC', breakpointLine: '#FFEAE8', executionLine: '#FFEAC4',
      keyword: '#0F54D6', string: '#8C6C41', number: '#AB2F6B', comment: '#248700', type: '#6B2FBA', struct: '#300073',
      method: '#00855F', member: '#0093A1', constant: '#0093A1', attribute: '#6B2FBA', preprocessor: '#808080', operator: '#383838'
    },
    terminal: {
      background: '#FFFFFF', foreground: '#2B2D30', cursor: '#000000', selection: 'rgba(53,116,240,0.25)',
      black: '#000000', red: '#C7222D', green: '#067D17', yellow: '#9E880D', blue: '#0F54D6', magenta: '#871094',
      cyan: '#00627A', white: '#6C707E', brightBlack: '#5A5D63', brightRed: '#E55765', brightGreen: '#208A3C',
      brightYellow: '#C29E4A', brightBlue: '#3574F0', brightMagenta: '#A846B9', brightCyan: '#0093A1', brightWhite: '#2B2D30'
    }
  }
]

export const DEFAULT_THEME_ID = 'oceanic'   // keeps the existing look; Rider themes are one click away
export const getTheme = (id: string | undefined): Theme => THEMES.find(t => t.id === id) ?? THEMES[0]

/** Push a theme's UI variables onto :root and recolor the native title-bar overlay. */
export function applyUiTheme(t: Theme): void {
  const root = document.documentElement
  for (const [k, v] of Object.entries(t.ui)) root.style.setProperty(k, v)
  // read by the editor's breakpoint / execution-point decorations
  root.style.setProperty('--ed-bp-line', t.editor.breakpointLine)
  root.style.setProperty('--ed-exec-line', t.editor.executionLine)
  root.style.setProperty('--ed-bg', t.editor.background)
  root.dataset.theme = t.kind
  root.style.colorScheme = t.kind
  window.arw?.ide?.setTitleBarColors({ color: t.ui['--bg-sidebar'], symbolColor: t.ui['--text-secondary'], bg: t.ui['--bg-base'] })
}
