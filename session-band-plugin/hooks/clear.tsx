import {
  atom,
  read,
  update,
  type CommandRunInput,
  type CommandRunResult,
  type EngineInterface,
  type Next,
  type Register,
} from 'claude-code'

import { toRepoInfo, type RepoInfo } from './repo'
import {
  buildDigest,
  extractSavedPath,
  isRealWork,
  parseReply,
  RECENT_SAVE_MS,
  summaryPrompt,
  SYSTEM_PROMPT,
  taskStateFile,
  type ParsedSummary,
} from './summary'

const edits = atom({ plugin: 'session-band', key: 'edits' } as const, 0)
const prompts = atom({ plugin: 'session-band', key: 'prompts' } as const, 0)

const REFUSED =
  'Clear refused: the transcript is already gone, nothing to summarise. Run save-session first, or re-run /clear.'
const CANCELLED = 'Clear cancelled: nothing was saved.'
const SAVE_FAILED = 'Clear cancelled: the save step failed.'

const reset = async ($: EngineInterface) => {
  await update($, edits, () => 0)
  await update($, prompts, () => 0)
}

const resolveRepo = async ($: EngineInterface): Promise<RepoInfo> => {
  const out = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  const [top, common] = out.stdout.trim().split('\n')

  if (out.exitCode !== 0 || !top || !common) return {}

  const taskId = (await $.fs.read(`${top}/.agent-task-id`).catch(() => '')).trim() || undefined

  return toRepoInfo(common, taskId)
}

const sessionsDir = async ($: EngineInterface): Promise<string | undefined> => {
  const out = await $.process.run(['agent-session', 'path'])
  return out.exitCode === 0 && out.stdout.trim() !== '' ? out.stdout.trim() : undefined
}

// A save in the last five minutes counts as "already saved by hand": the task
// state file's mtime in a task worktree, else the newest file in the sessions
// directory. (The non-task statePath is .claude/session-state.md, which the CLI
// maintains, so it is not the signal here.)
const recentlySaved = async ($: EngineInterface, repo: RepoInfo, nowMs: number): Promise<boolean> => {
  if (repo.taskId !== undefined && repo.statePath !== undefined) {
    const stat = await $.fs.stat(repo.statePath).catch(() => undefined)
    return stat !== undefined && nowMs - stat.mtimeMs <= RECENT_SAVE_MS
  }

  const dir = await sessionsDir($)
  if (dir === undefined) return false

  const entries = await $.fs.list(dir).catch(() => undefined)
  if (entries === undefined) return false

  let newest: number | undefined
  for (const entry of entries) {
    // Only session files count; index.json is rewritten by any save, by any harness.
    if (entry.kind === 'file' && entry.name.endsWith('.md') && (newest === undefined || entry.mtimeMs > newest)) {
      newest = entry.mtimeMs
    }
  }

  return newest !== undefined && nowMs - newest <= RECENT_SAVE_MS
}

const saveSession = async ($: EngineInterface, repo: RepoInfo, summary: ParsedSummary): Promise<string> => {
  // Task worktrees write the claimed state file; the orchestrator goes through
  // the agent-session CLI, which resolves the sessions directory itself.
  if (repo.statePath !== undefined && repo.taskId !== undefined) {
    await $.fs.write(repo.statePath, taskStateFile(repo.taskId, summary.body))
    return repo.statePath
  }

  const root = await $.session.root()
  const saved = await $.process.run(
    ['agent-session', 'save', '--harness', 'cc', '--goal', summary.goal, '--stdin'],
    { cwd: root, stdin: summary.body, timeoutMs: 30_000 },
  )
  if (saved.exitCode !== 0) throw new Error(`agent-session exit ${saved.exitCode}`)

  const path = extractSavedPath(saved.stdout)
  if (path !== undefined) return path

  const active = await $.process.run(['agent-session', 'active'])
  if (active.exitCode === 0 && active.stdout.trim() !== '') return active.stdout.trim()

  throw new Error('agent-session printed no path')
}

const fail = async (
  $: EngineInterface,
  e: CommandRunInput,
  next: Next<'command.run'>,
  reason: string,
): Promise<CommandRunResult> => {
  // A plugin or headless run has nobody to answer; refuse rather than hang.
  if (e.origin.kind !== 'composer') return { text: CANCELLED }

  try {
    const answer = await $.ui.ask(`Save failed (${reason}). Clear anyway?`, ['Clear anyway', 'Cancel'])
    if (answer === 'Clear anyway') {
      await reset($)
      return next(e)
    }
    return { text: CANCELLED }
  } catch {
    return { text: CANCELLED }
  }
}

export const register: Register = on => {
  // The module's own counters: real work is a successful edit tool or enough
  // prompts. The transcript may already be wiped by the time /clear runs.
  on('prompt.submit', async ($, e, next) => {
    await update($, prompts, n => n + 1)
    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] }, async ($, e, next) => {
    const result = await next(e)
    if (!('deny' in result)) {
      await update($, edits, n => n + 1)
    }
    return result
  })

  on('command.run', { command: 'clear' }, async ($, e, next) => {
    const [editCount, promptCount] = await Promise.all([read($, edits), read($, prompts)])
    if (!isRealWork({ edits: editCount, prompts: promptCount })) {
      await reset($)
      return next(e)
    }

    const repo = await resolveRepo($)
    const nowMs = await $.clock.now()
    if (await recentlySaved($, repo, nowMs)) {
      await reset($)
      return next(e)
    }

    const messages = await $.session.messages()
    if (messages.length === 0) {
      // Counters say work happened but the transcript is gone: refuse, and do
      // not reset, so a later save + /clear still reaches the recent-save skip.
      return { text: REFUSED }
    }

    const reply = await $.model.complete({
      model: 'sonnet',
      system: SYSTEM_PROMPT,
      prompt: summaryPrompt(buildDigest(messages)),
      maxTokens: 2000,
      effort: 'low',
      timeoutMs: 60_000,
    })

    const summary = reply.isAnswered ? parseReply(reply.text) : undefined
    if (summary === undefined) {
      return fail($, e, next, reply.isAnswered ? 'the summary was not parseable' : `model ${reply.reason}`)
    }

    try {
      const path = await saveSession($, repo, summary)
      await reset($)
      // The answer's text, not a toast: /clear ends the session and the toast went with it.
      const result = await next(e)
      return { ...result, text: `Session saved: ${path}` }
    } catch (error) {
      return fail($, e, next, String(error))
    }
  }).catch(($, e, next) => next.called ? next(e) : { text: SAVE_FAILED })
}
