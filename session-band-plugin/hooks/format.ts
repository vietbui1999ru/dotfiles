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

// ━━━━━━────── 50%: a heavy line fills the used share in half-cell steps (╸ is the half) over a
// light track, and the percentage follows the bar. One plain string, so the caller's single tone colours both.
export const ctxBar = (usedPct: number, width = 12): string => {
  const share = Math.min(100, Math.max(0, usedPct))
  const halves = Math.round((share / 100) * width * 2)
  const cells = Array.from({ length: width }, (_, i) => {
    const n = halves - i * 2
    return n >= 2 ? '━' : n === 1 ? '╸' : '─'
  })
  return `${cells.join('')} ${Math.round(share)}%`
}
