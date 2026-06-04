export const oceanic = {
  bgBase: '#0E1016',
  bgSidebar: '#13151D',
  bgRaised: '#171A24',
  bgCard: '#161922',
  bgTerminal: '#0D0F15',
  bgDeep: '#0D0F15',
  border: '#21252F',
  borderStrong: '#2C313F',
  textPrimary: '#E7EAF3',
  textSecondary: '#A6ADC0',
  textMuted: '#69708A',
  textFaint: '#474E63',
  accent: '#5BC9C0',
  accentDim: '#3C8F89',
  accentGlow: 'rgba(91,201,192,0.30)',
  selection: 'rgba(91,201,192,0.22)',
  status: {
    working: '#7FD88F',
    'needs-you': '#F2B45C',
    idle: '#5B6577',
    error: '#EB6F77'
  },
  // xterm ANSI (Oceanic-ish)
  ansi: {
    black: '#1A1D27', red: '#EB6F77', green: '#7FD88F', yellow: '#F2C57C',
    blue: '#82AAFF', magenta: '#C792EA', cyan: '#5BC9C0', white: '#C8CEDE',
    brightBlack: '#474E63', brightRed: '#FF8B92', brightGreen: '#9BE5A8', brightYellow: '#FFD89B',
    brightBlue: '#9CC0FF', brightMagenta: '#DDB0F6', brightCyan: '#7FE0D8', brightWhite: '#E7EAF3'
  }
} as const

/**
 * Curated header-color presets, tuned to the Oceanic palette. `value` is the base
 * hex stored on a terminal; the UI derives the header tint + focus accent from it
 * via color-mix. The first entry (Teal) matches the default --accent, so picking it
 * is visually equivalent to "Default" but makes the choice explicit.
 */
export const TERMINAL_COLOR_PRESETS = [
  { name: 'Teal', value: '#5BC9C0' },
  { name: 'Blue', value: '#82AAFF' },
  { name: 'Purple', value: '#C792EA' },
  { name: 'Green', value: '#7FD88F' },
  { name: 'Amber', value: '#F2C57C' },
  { name: 'Coral', value: '#EB6F77' },
  { name: 'Pink', value: '#F29BC4' },
  { name: 'Slate', value: '#8A93AB' }
] as const
