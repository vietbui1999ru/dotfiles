import type { EngineInterface } from 'claude-code'

export type RepoInfo = { taskId?: string; statePath?: string }

type Run = EngineInterface['process']['run']
type ReadFile = EngineInterface['fs']['read']

// Mirrors the shell hook: an agent worktree carries .agent-task-id, and its
// state lives in the main repo's .agents/claimed/, else .claude/session-state.md.
export const resolveRepo = async (processRun: Run, readFile: ReadFile): Promise<RepoInfo> => {
  const git = await processRun(['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  const [top, common] = git.stdout.trim().split('\n')
  if (git.exitCode !== 0 || !top || !common) return {}

  const mainRepo = common.slice(0, common.lastIndexOf('/')) // dirname of the common .git dir
  const taskId = (await readFile(`${top}/.agent-task-id`).catch(() => '')).trim() || undefined
  const statePath = taskId
    ? `${mainRepo}/.agents/claimed/${taskId}.state.md`
    : `${mainRepo}/.claude/session-state.md`

  return { taskId, statePath }
}
