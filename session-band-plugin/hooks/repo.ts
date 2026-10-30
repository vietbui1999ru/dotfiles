export type RepoInfo = { statePath?: string }

// The session state file lives in the main repo's .claude/session-state.md.
// (Commandr's per-task state files are retired: the pueue queue replaced its task bus.)
// `common` is the absolute git-common-dir; its dirname is the main repo.
export const toRepoInfo = (common: string): RepoInfo => {
  const mainRepo = common.slice(0, common.lastIndexOf('/'))

  return { statePath: `${mainRepo}/.claude/session-state.md` }
}
