import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import type { Usage } from '../types'
import { drawBand } from './band'
import { captureSession, register as registerBlast } from './blast'
import { register as registerClear } from './clear'
import { register as registerHandoff } from './handoff.tsx'
import { register as registerHistory } from './history.tsx'
import { register as registerPane } from './pane.tsx'
import { refreshSendIt, register as registerSendIt } from './send-it.tsx'
import { register as registerWorktrees } from './worktree-pane.tsx'
import { register as registerDraftPrs } from './draft-prs.tsx'
import { register as registerGates } from './gates.tsx'
import { summarize, type TrackedTask } from './handoff'
import type { PiProgress } from './pisession'
import { parsePending, pendingRecordFor, reviewState, type ReviewState } from './review'
import { shortDir, shortModel, whole } from './format'
import { toSnapshot, type GitFacts } from './git'
import { toRepoInfo, type RepoInfo } from './repo'
import { heartbeatBody, heartbeatPath, HEARTBEAT_INTERVAL_MS } from './heartbeat'
import { openForSession, parseAlerts } from './mistake-alerts'
import { guardAgent, softStop, type SoftStopCheck } from './threshold'

const usage = atom({ plugin: 'session-band', key: 'usage' } as const, {})
const git = atom({ plugin: 'session-band', key: 'git' } as const, null)
const outputStyle = atom({ plugin: 'session-band', key: 'outputStyle' } as const, null)
const isNotified = atom({ plugin: 'session-band', key: 'isNotified' } as const, false)
const handoff = atom({ plugin: 'session-band', key: 'handoff' } as const, { tasks: [] as TrackedTask[], available: true })
const progress = atom({ plugin: 'session-band', key: 'progress' } as const, {} as Record<number, PiProgress>)

const asWhole = (percent: number | undefined) => (percent === undefined ? undefined : whole(percent))

const measuredUsage = (context: { percent?: number }, rateLimits: readonly { kind: string; percentUsed: number }[]): Usage => ({
  ctx: asWhole(context.percent),
  five: asWhole(rateLimits.find(limit => limit.kind === 'five_hour')?.percentUsed),
  seven: asWhole(rateLimits.find(limit => limit.kind === 'seven_day')?.percentUsed),
})

const refreshGit = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const run = async (args: string[]) => {
    const r = await $.process.run(['git', '-C', cwd, '--no-optional-locks', ...args])
    return r.exitCode === 0 ? r.stdout.trim() : undefined
  }
  const branch = await run(['branch', '--show-current'])
  let facts: GitFacts = { isDirty: false }

  if (branch) {
    const [unstaged, staged, upstream, stash, gitDir, common] = await Promise.all([
      $.process.run(['git', '-C', cwd, '--no-optional-locks', 'diff', '--quiet']),
      $.process.run(['git', '-C', cwd, '--no-optional-locks', 'diff', '--cached', '--quiet']),
      run(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]),
      run(['stash', 'list']),
      run(['rev-parse', '--absolute-git-dir']),
      run(['rev-parse', '--path-format=absolute', '--git-common-dir']),
    ])
    const counts = upstream ? await run(['rev-list', '--left-right', '--count', `${upstream}...HEAD`]) : undefined
    facts = { branch, isDirty: unstaged.exitCode !== 0 || staged.exitCode !== 0, upstream, counts, stash, gitDir, common }
  }

  await update($, git, () => toSnapshot(facts))
}

const resolveRepo = async ($: EngineInterface): Promise<RepoInfo> => {
  const out = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  const [top, common] = out.stdout.trim().split('\n')

  if (out.exitCode !== 0 || !top || !common) return {}

  const taskId = (await $.fs.read(`${top}/.agent-task-id`).catch(() => '')).trim() || undefined

  return toRepoInfo(common, taskId)
}

const settingStyle = async ($: EngineInterface): Promise<string | null> => {
  const settings = await $.settings.read()
  const style = settings.outputStyle

  return typeof style === 'string' ? style : null
}

const styleForBand = (style: string | null) => (style === 'default' ? null : style)

async function reviewRoot($: EngineInterface, cwd: string): Promise<string> {
  const result = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined)
  return result?.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : cwd
}

async function reviewStates($: EngineInterface, tasks: readonly TrackedTask[]): Promise<Record<number, ReviewState>> {
  const remembered = new Map<number, string>()
  const values = await Promise.all(tasks.map(async task => {
    const root = `${await reviewRoot($, task.cwd)}/.pi/agent-review`
    const pendingFiles = await $.fs.list(`${root}/pending`).catch(() => [])
    const pending = [] as NonNullable<ReturnType<typeof parsePending>>[]
    for (const file of pendingFiles) {
      if (file.kind !== 'file') continue
      const match = file.name.match(/^(.+)\.(json|processing)$/)
      if (!match) continue
      const runId = match[1]!
      const parsed = parsePending(await $.fs.read(`${root}/pending/${file.name}`).catch(() => ''))
      if (parsed && parsed.runId === runId) pending.push(parsed)
      else if (match[2] === 'processing') pending.push({ runId, files: [] })
    }
    const current = pendingRecordFor(task, pending)
    const runId = task.runId ?? current?.runId
    if (!task.runId && runId) remembered.set(task.id, runId)
    let decision: unknown
    if (runId) {
      try { decision = JSON.parse(await $.fs.read(`${root}/decisions/${runId}.json`)) } catch { /* absent or malformed decision is opaque */ }
    }
    return [task.id, reviewState(current, decision)] as const
  }))
  if (remembered.size > 0) {
    await update($, handoff, state => ({
      ...state,
      tasks: state.tasks.map(task => remembered.has(task.id) ? { ...task, runId: remembered.get(task.id) } : task),
    }))
  }
  return Object.fromEntries(values)
}

// Every HEARTBEAT_INTERVAL_MS: write the liveness file (the status line fallback goes silent while it is fresh),
// and re-read usage and git so the band does not depend on Bash calls or turn ends to stay current.
const startHeartbeat = async ($: EngineInterface) => {
  const tmp = await $.env.get('TMPDIR') ?? '/tmp'
  // A failed id lookup must not cost the session its start hooks: an empty id yields no heartbeat path.
  const path = heartbeatPath(tmp, await $.session.id().catch(() => ''))
  const beat = async () => {
    if (path) await $.fs.write(path, heartbeatBody(await $.clock.now(), await $.session.cwd()))
    const current = await $.session.usage()
    await update($, usage, () => measuredUsage(current.context, current.rateLimits))
    await refreshGit($)
  }
  if (path) await $.fs.write(path, heartbeatBody(await $.clock.now(), await $.session.cwd()))
  $.clock.every(HEARTBEAT_INTERVAL_MS, () => { void beat().catch(() => undefined) })
}

export const register: Register = on => {
  registerBlast(on)
  registerClear(on)
  registerHandoff(on)
  registerHistory(on)
  registerPane(on)
  registerWorktrees(on)
  registerDraftPrs(on)
  registerGates(on)
  registerSendIt(on)

  // The settings fallback only matters before the first prompt.compose names the style.
  let hasComposed = false
  let settingsStyle: Promise<string | null> | undefined

  on('session.start', async ($, e, next) => {
    captureSession(e.isInteractive)
    // A heartbeat failure must not cost the session its command registrations (F3).
    await startHeartbeat($).catch(() => undefined)
    // A settings read failure leaves send-it off for this session rather than failing the start.
    await refreshSendIt($).catch(() => false)
    await $.command.register({ name: 'pi', description: 'Open Pi hand-off controls, or kill/pause/resume/rm/hold Pi tasks', argumentHint: '[kill|pause|resume|rm|hold] [ids|all] | release', immediate: true })
    await $.command.register({ name: 'pi-history', description: 'Open Pi hand-off history' })
    await $.command.register({ name: 'worktrees', description: 'Open the worktrees and branches pane' })
    await $.command.register({ name: 'draft-prs', description: 'Open the draft PRs pane: open drafts, ready PRs and merges from the last 7 days' })
    await $.command.register({ name: 'gates', description: 'Open spec approvals and pending Pi reviews across worktrees' })
    await $.command.register({ name: 'send-it', description: 'Turn send-it mode on or off for this repo, or show its state', argumentHint: 'on|off|status' })
    const current = await $.session.usage()
    await Promise.all([
      update($, usage, () => measuredUsage(current.context, current.rateLimits)),
      refreshGit($),
    ])

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => measuredUsage(e.context, e.rateLimits))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refreshGit($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const { context } = await $.session.usage()
    const r = await next(e)

    // Not awaited: the band catches up on redraw, and the tool result must not wait on ~7 git calls.
    if (e.tool === 'Bash') void refreshGit($).catch(() => undefined)
    if ('deny' in r) return r

    return (async () => {
      const { taskId, statePath } = await resolveRepo($)
      const lastSavedMs = statePath
        ? await $.fs.stat(statePath).then(stat => stat.mtimeMs).catch(() => undefined)
        : undefined
      const filePath = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : undefined
      const check: SoftStopCheck = {
        percent: asWhole(context.percent),
        tool: e.tool,
        filePath,
        command: e.tool === 'Bash' ? e.command : undefined,
        nowMs: await $.clock.now(),
        isNotified: await read($, isNotified),
        taskId,
        lastSavedMs,
      }
      const stop = softStop(check)

      if (stop.action === 'clear') {
        await update($, isNotified, () => false)
      } else if (stop.action === 'notify') {
        await update($, isNotified, () => true)

        return { ...r, context: [...(r.context ?? []), stop.text] }
      }

      return r
    })().catch(() => r)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const { context } = await $.session.usage()
    const denial = guardAgent(asWhole(context.percent), e.tool)

    return denial ? { deny: denial } : next(e)
  }).catch(($, e, next) => next.called ? next(e) : { deny: 'session-band guard failed' })

  on('prompt.compose', async ($, e, next) => {
    hasComposed = true
    await update($, outputStyle, () => e.outputStyle?.name ?? null)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [cwd, home, model, currentUsage, currentGit, capturedStyle, currentHandoff, currentProgress, nowMs] = await Promise.all([
      $.session.cwd(),
      $.env.get('HOME'),
      $.session.model(),
      read($, usage),
      read($, git),
      read($, outputStyle),
      read($, handoff),
      read($, progress),
      $.clock.now(),
    ])
    const currentReview = await reviewStates($, currentHandoff.tasks)
    // Mistake alerts are written by the PostToolUseFailure hook; the band shows only this session's open ones.
    const sessionId = await $.session.id().catch(() => '')
    const alertsRaw = home ? await $.fs.read(`${home}/.claude/state/mistake-alerts.json`).catch(() => undefined) : undefined
    const openAlerts = openForSession(parseAlerts(typeof alertsRaw === 'string' ? alertsRaw : undefined), sessionId)
    if (!hasComposed) settingsStyle ??= settingStyle($).catch(() => null)
    const style = styleForBand(capturedStyle ?? (hasComposed ? null : await settingsStyle))

    return drawBand($.ui.resolve(e), {
      dir: shortDir(cwd, home),
      model: shortModel(model),
      usage: currentUsage,
      git: currentGit,
      style,
      handoff: currentHandoff.available ? summarize(currentHandoff.tasks, currentProgress, currentReview, nowMs) ?? undefined : undefined,
      width: e.props.bodyColumns,
      onPi: () => { void $.ui.open({ id: 'pi-handoff', title: 'Pi hand-off', focus: true }) },
      onWorktrees: () => { void $.ui.open({ id: 'worktrees', title: 'Worktrees', focus: true }) },
      onPiHistory: () => { void $.ui.open({ id: 'pi-history', title: 'Pi history', focus: true }) },
      onDraftPrs: () => { void $.ui.open({ id: 'draft-prs', title: 'Draft PRs', focus: true }) },
      openAlerts,
    })
  })
}
