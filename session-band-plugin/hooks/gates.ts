import type { Worktree } from './worktrees'

export type SpecState = 'draft' | 'approved' | 'stale' | 'invalid'
export type SpecRow = { kind: 'spec'; key: string; worktree: string; branch: string; path: string; rel: string; state?: SpecState; error?: string }
export type ReviewEntry = { runId: string; owner: string | null; branch: string; name: string; startedAt: string; processing: boolean; error: boolean; landed: boolean; orphan: boolean }
export type ReviewRow = { kind: 'review'; key: string; worktree: string | null; entry: ReviewEntry }
export type GateRow = SpecRow | ReviewRow

export const acRunArgv = (home: string, sub: 'status' | 'show' | 'approve' | 'reject', spec: string): string[] => [`${home}/dotfiles/scripts/ac-run`, sub, spec]
export const approveTimeoutMs = (runnable: number): number => (75 + 120 * runnable + 30) * 1000
export const editRemoteArgv = (socket: string, path: string): string[] => ['nvim', '--server', socket, '--remote-send', `<C-\\><C-N>:edit ${path.replace(/[ \\%#|"<>\r\n]/g, char => char === '<' ? '<LT>' : `\\${char}`)}<CR>`]

export const specBranch = (text: string): string | undefined => {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return undefined
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end < 0) return undefined
  return lines.slice(1, end).find(line => /^branch\s*:/.test(line))?.split(':').slice(1).join(':').trim() || undefined
}

export const specRows = (tree: Worktree, files: readonly { rel: string; text: string }[]): SpecRow[] =>
  tree.detached || !tree.branch ? [] : files.filter(file => specBranch(file.text) === tree.branch).map(file => {
    const path = `${tree.path.replace(/\/$/, '')}/${file.rel}`
    return { kind: 'spec', key: path, path, rel: file.rel, branch: tree.branch!, worktree: tree.path }
  })

export const parseSpecStatus = (r: { exitCode: number; stdout: string; stderr: string }): { state: SpecState; error?: string } => {
  if (r.exitCode === 0) return { state: 'approved' }
  if (r.exitCode === 3) return { state: r.stdout.startsWith('stale') ? 'stale' : 'draft' }
  return { state: 'invalid', error: r.stderr.split('\n').find(line => line.trim())?.trim() }
}
