// Gruvbox Material Dark Soft, the ANSI-256 values from statusline-command.sh as hex.
export const PALETTE = {
  peach: '#d7875f',
  green: '#a9b665',
  teal: '#87afaf',
  mauve: '#d787af',
  yellow: '#d8a657',
  red: '#d75f5f',
  muted: '#878787',
} as const

export type Tone = keyof typeof PALETTE

// Context warns early (the threshold guard fires at 70); limits warn late.
export const ctxTone = (pct: number): Tone =>
  pct >= 70 ? 'red' : pct >= 40 ? 'yellow' : 'green'

export const limitTone = (pct: number): Tone =>
  pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green'
