import type { EngineInterface } from 'claude-code'

import type { GitSnapshot } from '../types'

type Run = EngineInterface['process']['run']

const run = async (processRun: Run, cwd: string, args: string[]) => {
  const r = await processRun(['git', '-C', cwd, '--no-optional-locks', ...args])
  return r.exitCode === 0 ? r.stdout.trim() : undefined
}

// Same facts as the retired shell line: branch, dirty, ahead/behind, stash, worktree.
export const readGit = async (processRun: Run, cwd: string): Promise<GitSnapshot | null> => {
  const branch = await run(processRun, cwd, ['branch', '--show-current'])
  if (!branch) return null

  const [unstaged, staged, upstream, stash, gitDir, common] = await Promise.all([
    processRun(['git', '-C', cwd, '--no-optional-locks', 'diff', '--quiet']),
    processRun(['git', '-C', cwd, '--no-optional-locks', 'diff', '--cached', '--quiet']),
    run(processRun, cwd, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]),
    run(processRun, cwd, ['stash', 'list']),
    run(processRun, cwd, ['rev-parse', '--absolute-git-dir']),
    run(processRun, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  ])
  const counts = upstream && (await run(processRun, cwd, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]))
  const [behind = 0, ahead = 0] = (counts || '').split(/\s+/).map(Number)
  const isLinked = !!gitDir && !!common && gitDir !== common
  // A linked worktree's git dir is <main>/.git/worktrees/<name>; the shell script took
  // the parent of that and so always printed "worktrees".
  const worktree = isLinked ? gitDir.split('/').pop()?.replace(/^worktree-/, '') : undefined

  return {
    branch,
    isDirty: unstaged.exitCode !== 0 || staged.exitCode !== 0,
    ahead,
    behind,
    hasUpstream: !!upstream,
    stash: stash ? stash.split('\n').length : 0,
    worktree,
  }
}
