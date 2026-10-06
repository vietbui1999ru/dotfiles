export const DENY_AGENT = `CONTEXT THRESHOLD (70%+): Agent spawns are blocked at this context level.
Save session state (save-session skill) and clear context first, then retry.`

export const stillOver = (taskId?: string): string =>
  taskId
    ? `CONTEXT SOFT STOP (still 70%+, agent task: ${taskId}): Save your current state and return early.
Invoke the save-session skill to write progress to .agents/claimed/${taskId}.state.md,
then stop and return a status summary to the orchestrator.`
    : 'CONTEXT SOFT STOP (still 70%+): Save session state, then ask the user to clear context before continuing.'

export const firstCrossing = (taskId?: string): string =>
  taskId
    ? `CONTEXT SOFT STOP (70%+, agent task: ${taskId}): Last tool completed. Context at threshold.

This is an autonomous agent context — do not wait for user input. Instead:
1. Invoke the save-session skill to write current progress to:
     .agents/claimed/${taskId}.state.md
2. Return early to the orchestrator with a status summary:
     "Context threshold reached at 70%+. State saved. Completed: [X]. Remaining: [Y]."
3. Do not start new tool calls other than save-session writes and git reads.`
    : `CONTEXT SOFT STOP (70%+): Last tool completed. Context is at threshold.

1. Invoke the save-session skill now to persist progress.
2. Then ask the user to clear or compact context before further work.

Do not execute further tool calls unless they are part of saving session state
(save-session writes, git reads, memory writes).`
