// Last two path segments, with ~ for home; a project root shows its basename alone.
export const shortDir = (cwd: string, home: string | undefined): string => {
  if (home && cwd === home) return '~'
  const rel = home && cwd.startsWith(`${home}/`) ? cwd.slice(home.length + 1) : undefined
  const parts = (rel ?? cwd).split('/').filter(Boolean)
  if (rel !== undefined && parts.length <= 1) return rel
  return parts.slice(-2).join('/')
}

// claude-opus-5-5 -> opus-5-5, as the status line did with display names.
export const shortModel = (model: string): string => model.replace(/^claude-/, '')

export const whole = (pct: number): number => Math.round(pct)

// Context still free, as the old status line showed it: 100 - used, never below zero.
export const ctxLeft = (usedPct: number): number => Math.max(0, 100 - usedPct)

// [####50%-----]: '#' fills to the used share, the percentage sits in the middle of the bar.
export const ctxBar = (usedPct: number, width = 12): string => {
  const share = Math.min(100, Math.max(0, usedPct))
  const filled = Math.round((share / 100) * width)
  const cells = Array.from({ length: width }, (_, i) => (i < filled ? '#' : '-'))
  const label = `${Math.round(share)}%`
  const start = Math.floor((width - label.length) / 2)
  label.split('').forEach((ch, i) => { cells[start + i] = ch })
  return `[${cells.join('')}]`
}
