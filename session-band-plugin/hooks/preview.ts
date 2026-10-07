export type PreviewTarget = {
  path: string
  bytes?: number
  tracked?: boolean
}

export type PreviewFacts = {
  command: string
  reason: string
  targets?: readonly PreviewTarget[]
  totalBytes?: number
  unexpandedGlobs?: readonly string[]
  dryRun?: {
    label: string
    output: string
  }
}

const MAX_LINES = 40

const bytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

const cap = (lines: readonly string[]) => {
  if (lines.length <= MAX_LINES) return [...lines]

  const omitted = lines.length - (MAX_LINES - 1)
  return [...lines.slice(0, MAX_LINES - 1), `… ${omitted} preview lines omitted`]
}

export const preview = (facts: PreviewFacts): string => {
  const targets = facts.targets ?? []
  const lines = [
    'Blast-radius check',
    `Command: ${facts.command}`,
    `Why: ${facts.reason}`,
    `Targets: ${targets.length}${facts.totalBytes === undefined ? '' : `, ${bytes(facts.totalBytes)} total`}`,
  ]

  for (const target of targets) {
    const size = target.bytes === undefined ? '' : ` (${bytes(target.bytes)})`
    let tracked = ''
    if (target.tracked === true) tracked = ', git-tracked'
    if (target.tracked === false) tracked = ', not git-tracked'
    lines.push(`  ${target.path}${size}${tracked}`)
  }

  for (const glob of facts.unexpandedGlobs ?? []) lines.push(`Glob not expanded: ${glob}`)

  if (facts.dryRun) {
    lines.push(`Dry run (${facts.dryRun.label}):`)
    lines.push(...facts.dryRun.output.split('\n').flatMap(line => line ? [`  ${line}`] : []))
  }

  return cap(lines).join('\n')
}
