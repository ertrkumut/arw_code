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
