import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

// One Claude session's review state: where it started, and every file it touched since its last approval.
export type SessionReview = { sessionId: string; worktree: string; baseTree: string; touched: string[]; approvedAt?: string }

const PI_STATE = '.pi'

// Outside any repository, so an agent editing the worktree cannot casually clear its own set.
export const statePath = (home: string, sessionId: string): string =>
  `${home.replace(/\/+$/, '')}/.local/state/session-band/review/${sessionId}.json`

let warned = false

// A failed snapshot must never fail the tool call: record nothing, and say why once in the debug log.
function noteFailure($: EngineInterface, error: unknown): void {
  if (warned) return
  warned = true
  try {
    $.ui.log(`review touch: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  } catch {
    // the debug log is best effort
  }
}

// The snapshot is a tree object built in a throwaway index, as agent-review's is.
let scratch = 0

async function repoRoot($: EngineInterface, worktree: string): Promise<string> {
  const result = await $.process.run(['git', '-C', worktree, 'rev-parse', '--show-toplevel']).catch(() => undefined)
  return result?.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : worktree
}

/**
 * A tree hash of the worktree as it stands, built in a throwaway index that is deleted afterwards:
 * the real index is never read or written. Untracked, unignored files are in it; `.pi/` is not.
 */
export async function snapshotTree($: EngineInterface, worktree: string): Promise<string> {
  const root = await repoRoot($, worktree)
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
  scratch += 1
  const index = `${tmp}/session-band-review-${scratch}.index`
  const env = { GIT_INDEX_FILE: index }
  try {
    const added = await $.process.run(['git', '-C', root, 'add', '-A', '--', '.'], { env, timeoutMs: 60_000 })
    if (added.exitCode !== 0) throw new Error(`git add failed in ${root}`)
    // The obvious `:(exclude)` pathspec fails the whole add when the ignored path exists on disk;
    // adding everything and then dropping `.pi/` from the scratch index does not.
    await $.process.run(['git', '-C', root, 'rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', PI_STATE], { env, timeoutMs: 60_000 })
    const tree = await $.process.run(['git', '-C', root, 'write-tree'], { env, timeoutMs: 60_000 })
    const hash = tree.stdout.trim()
    if (tree.exitCode !== 0 || hash === '') throw new Error(`git write-tree failed in ${root}`)
    return hash
  } finally {
    await $.process.run(['rm', '-f', index]).catch(() => undefined)
  }
}

export async function changedPaths($: EngineInterface, worktree: string, before: string, after: string): Promise<string[]> {
  const root = await repoRoot($, worktree)
  const result = await $.process.run(['git', '-C', root, 'diff', '--name-only', '--no-renames', before, after]).catch(() => undefined)
  if (result?.exitCode !== 0) return []
  return result.stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
}

const relative = (root: string, path: string): string | undefined => {
  const base = root.replace(/\/+$/, '')
  if (path.startsWith(`${base}/`)) return path.slice(base.length + 1)
  if (path.startsWith('/')) return undefined
  return path.replace(/^\.\//, '')
}

const inPiState = (path: string): boolean => path === PI_STATE || path.startsWith(`${PI_STATE}/`)

const parseSession = (text: string): SessionReview | undefined => {
  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const row = value as Record<string, unknown>
    if (typeof row.sessionId !== 'string' || typeof row.worktree !== 'string' || typeof row.baseTree !== 'string') return undefined
    if (!Array.isArray(row.touched) || !row.touched.every(item => typeof item === 'string')) return undefined
    return {
      sessionId: row.sessionId,
      worktree: row.worktree,
      baseTree: row.baseTree,
      touched: row.touched as string[],
      ...(typeof row.approvedAt === 'string' ? { approvedAt: row.approvedAt } : {}),
    }
  } catch {
    return undefined
  }
}

async function load($: EngineInterface, sessionId: string): Promise<SessionReview | undefined> {
  const home = await $.env.get('HOME')
  if (home === undefined) return undefined
  const text = await $.fs.read(statePath(home, sessionId)).catch(() => '')
  return parseSession(text)
}

async function save($: EngineInterface, state: SessionReview): Promise<void> {
  const home = await $.env.get('HOME')
  if (home === undefined) return
  await $.fs.write(statePath(home, state.sessionId), `${JSON.stringify(state)}\n`)
}

/**
 * Adds repo-relative paths to the session's touched set, deduplicated and sorted. The first touch
 * also writes the state, with the worktree as it stands as `baseTree`. Nothing under `.pi/` counts,
 * and a path outside the worktree cannot appear in its diff, so neither is recorded.
 */
export async function recordTouch($: EngineInterface, sessionId: string, worktree: string, paths: readonly string[]): Promise<void> {
  if (sessionId === '' || paths.length === 0) return
  const existing = await load($, sessionId)
  const root = existing?.worktree ?? await repoRoot($, worktree)
  const touched = new Set(existing?.touched ?? [])
  for (const path of paths) {
    const rel = relative(root, path)
    if (rel === undefined || rel === '' || inPiState(rel)) continue
    touched.add(rel)
  }
  if (existing === undefined && touched.size === 0) return
  await save($, {
    sessionId,
    worktree: root,
    baseTree: existing?.baseTree ?? await snapshotTree($, root),
    touched: [...touched].sort(),
    ...(existing?.approvedAt === undefined ? {} : { approvedAt: existing.approvedAt }),
  })
}

// A touch log that fails must never fail the tool call.
async function recordSafely($: EngineInterface, worktree: string, paths: readonly string[]): Promise<void> {
  try {
    const sessionId = await $.session.id()
    if (!sessionId) return
    await recordTouch($, sessionId, worktree, paths)
  } catch (error) {
    noteFailure($, error)
  }
}

async function recordFile($: EngineInterface, path: string | undefined): Promise<void> {
  if (path === undefined) return
  const cwd = await $.session.cwd().catch(() => '')
  await recordSafely($, cwd, [path])
}

export const register: Register = on => {
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const result = await next(e)
    if (!('deny' in result)) await recordFile($, e.file_path)
    return result
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    if (!('deny' in result)) await recordFile($, e.file_path)
    return result
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const result = await next(e)
    if (!('deny' in result)) await recordFile($, e.notebook_path)
    return result
  })

  // Bash can change files too, so the worktree is snapshotted around the call.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cwd = await $.session.cwd().catch(() => '')
    const before = await snapshotTree($, cwd).catch(error => {
      noteFailure($, error)
      return undefined
    })
    const result: ToolCallResult = await next(e)
    if (before === undefined || 'deny' in result) return result
    const after = await snapshotTree($, cwd).catch(error => {
      noteFailure($, error)
      return undefined
    })
    if (after === undefined) return result
    const paths = await changedPaths($, cwd, before, after).catch(() => [])
    await recordSafely($, cwd, paths)
    return result
  })
}
