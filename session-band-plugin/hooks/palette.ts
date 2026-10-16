// Gruvbox Material Dark Soft, the retired shell line's ANSI-256 values as hex.
export const PALETTE = {
  peach: '#d7875f',
  green: '#a9b665',
  teal: '#87afaf',
  mauve: '#d787af',
  yellow: '#d8a657',
  red: '#d75f5f',
  orange: '#e78a4e',
  muted: '#878787',
} as const

export type Tone = keyof typeof PALETTE

// Context warns early: red is the 70% line where the threshold guard asks for a save and clear.
export const ctxTone = (pct: number): Tone =>
  pct >= 70 ? 'red' : pct >= 40 ? 'orange' : 'green'

export const limitTone = (pct: number): Tone =>
  pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green'
