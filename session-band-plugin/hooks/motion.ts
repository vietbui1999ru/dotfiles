export type Motion = 'down' | 'up' | 'top'

/** The row id a vim motion lands on: j/k stop at the ends as in vim, g goes to the first row. */
export const moveTo = (ids: readonly number[], current: number | undefined, motion: Motion): number | undefined => {
  const at = current === undefined ? -1 : ids.indexOf(current)
  if (motion === 'top' || at < 0) return ids[0]
  return ids[Math.min(ids.length - 1, Math.max(0, at + (motion === 'down' ? 1 : -1)))]
}
