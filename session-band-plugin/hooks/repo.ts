export type RepoInfo = { taskId?: string; statePath?: string }

// Mirrors the shell hook: an agent worktree carries .agent-task-id, and its
// state lives in the main repo's .agents/claimed/, else .claude/session-state.md.
// `common` is the absolute git-common-dir; its dirname is the main repo.
export const toRepoInfo = (common: string, taskId: string | undefined): RepoInfo => {
  const mainRepo = common.slice(0, common.lastIndexOf('/'))

  return {
    taskId,
    statePath: taskId
      ? `${mainRepo}/.agents/claimed/${taskId}.state.md`
      : `${mainRepo}/.claude/session-state.md`,
  }
}
