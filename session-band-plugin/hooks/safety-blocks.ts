// Reads the bash-safety block log the PreToolUse hook appends and the human verdicts
// scripts/safety-log writes (docs/workflows/bash-safety-log.md). Pure reading and shaping:
// the band counts this session's pending blocks, the pane lists them and marks through the CLI.
import type { EngineInterface } from 'claude-code'

export type SafetyVerdict = 'ok' | 'false-positive'

export type SafetyBlock = {
  id: string
  ts: string
  session: string
  cwd: string
  transcript: string
  rule: string
  command: string
  reason: string
}

/** One logged block with the human verdict it has, if any. */
export type SafetyBlockRow = SafetyBlock & { verdict?: SafetyVerdict }

export const BLOCKS_FILE = 'bash-safety-blocks.jsonl'
export const VERDICTS_FILE = 'bash-safety-verdicts.jsonl'
export const SAFETY_LOG = 'dotfiles/scripts/safety-log'

/** The one CLI write the pane makes: `safety-log mark <id> ok|false-positive`. */
export const safetyLogArgv = (home: string, id: string, verdict: SafetyVerdict): string[] =>
  [`${home}/${SAFETY_LOG}`, 'mark', id, verdict]

// The hook honours SAFETY_LOG_DIR, so the band follows it and both read the same directory.
export const stateDir = (home: string | undefined, override: string | undefined): string | undefined =>
  override ?? (home ? `${home}/.claude/state` : undefined)

const objects = (text: string | undefined): Record<string, unknown>[] =>
  (text ?? '').split('\n').flatMap(line => {
    if (!line.trim()) return []
    try {
      const value: unknown = JSON.parse(line)
      return value !== null && typeof value === 'object' ? [value as Record<string, unknown>] : []
    } catch {
      return []
    }
  })

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Every block line with an id; malformed lines and foreign objects read as nothing. */
export const parseBlocks = (texts: readonly (string | undefined)[]): SafetyBlock[] =>
  texts.flatMap(body => objects(body).flatMap(entry => {
    const id = text(entry.id)
    if (!id) return []
    return [{
      id,
      ts: text(entry.ts),
      session: text(entry.session),
      cwd: text(entry.cwd),
      transcript: text(entry.transcript),
      rule: text(entry.rule),
      command: text(entry.command),
      reason: text(entry.reason),
    }]
  }))

/** Verdicts by id; the last line for an id wins, as `safety-log` does. */
export const parseVerdicts = (body: string | undefined): Map<string, SafetyVerdict> => {
  const latest = new Map<string, SafetyVerdict>()
  for (const entry of objects(body)) {
    const id = text(entry.id)
    const verdict = text(entry.verdict)
    if (id && (verdict === 'ok' || verdict === 'false-positive')) latest.set(id, verdict)
  }
  return latest
}

const moment = (ts: string): number => {
  const parsed = Date.parse(ts)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Newest first, as `safety-log` lists them. */
export const newestFirst = (blocks: readonly SafetyBlock[]): SafetyBlock[] =>
  [...blocks].sort((a, b) => moment(b.ts) - moment(a.ts))

export const judge = (blocks: readonly SafetyBlock[], verdicts: ReadonlyMap<string, SafetyVerdict>): SafetyBlockRow[] =>
  blocks.map(block => ({ ...block, verdict: verdicts.get(block.id) }))

export const sessionRows = (rows: readonly SafetyBlockRow[], sessionId: string): SafetyBlockRow[] =>
  sessionId ? rows.filter(row => row.session === sessionId) : []

/** The chip's count: this session's blocks a human has not judged yet. */
export const pendingCount = (rows: readonly SafetyBlockRow[]): number => rows.filter(row => row.verdict === undefined).length

const clock = (ts: string): string => (ts.length >= 19 ? ts.slice(11, 19) : ts || '?')

/** One pane row: time, rule, verdict or pending, then the redacted command the hook recorded. */
export const safetyBlockLine = (row: SafetyBlockRow): string =>
  `${clock(row.ts)}  ${row.rule || 'other'}  ${row.verdict ?? 'pending'}  ${row.command.replace(/\s+/g, ' ').trim()}`

/** This session's blocks, newest first, across the current log and its rotated predecessor. */
export async function loadSessionBlocks($: EngineInterface): Promise<SafetyBlockRow[]> {
  let home: string | undefined
  let override: string | undefined
  try {
    home = await $.env.get('HOME')
  } catch {
    home = undefined
  }
  try {
    override = await $.env.get('SAFETY_LOG_DIR')
  } catch {
    override = undefined
  }
  const dir = stateDir(home, override)
  if (!dir) return []
  const [rotated, current, verdictsBody] = await Promise.all([
    $.fs.read(`${dir}/${BLOCKS_FILE}.1`).catch(() => undefined),
    $.fs.read(`${dir}/${BLOCKS_FILE}`).catch(() => undefined),
    $.fs.read(`${dir}/${VERDICTS_FILE}`).catch(() => undefined),
  ])
  let sessionId = ''
  try {
    sessionId = await $.session.id()
  } catch {
    sessionId = ''
  }
  return sessionRows(judge(newestFirst(parseBlocks([rotated, current])), parseVerdicts(verdictsBody)), sessionId)
}
