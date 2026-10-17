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

// ████50%░░░░░: block glyphs fill to the used share in eighth-cell steps and the percentage
// overwrites the middle cells. One plain string, so the caller's single tone colours the label too.
const PARTIAL = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
export const ctxBar = (usedPct: number, width = 12): string => {
  const share = Math.min(100, Math.max(0, usedPct))
  const eighths = Math.round((share / 100) * width * 8)
  const cells = Array.from({ length: width }, (_, i) => {
    const n = eighths - i * 8
    return n >= 8 ? '█' : n > 0 ? PARTIAL[n] : '░'
  })
  const label = `${Math.round(share)}%`
  const start = Math.floor((width - label.length) / 2)
  label.split('').forEach((ch, i) => { cells[start + i] = ch })
  return cells.join('')
}
