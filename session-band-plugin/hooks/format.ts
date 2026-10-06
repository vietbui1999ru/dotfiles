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
