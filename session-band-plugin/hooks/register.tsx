import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import type { Usage } from '../types'
import { drawBand } from './band'
import { captureSession, register as registerBlast } from './blast'
import { register as registerClear } from './clear'
import { register as registerHandoff } from './handoff.tsx'
import { register as registerPane } from './pane.tsx'
import { summarize, type TrackedTask } from './handoff'
import type { PiProgress } from './pisession'
import { parsePending, reviewState, type ReviewState } from './review'
import { shortDir, shortModel, whole } from './format'
import { toSnapshot, type GitFacts } from './git'
import { toRepoInfo, type RepoInfo } from './repo'
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

async function reviewStates($: EngineInterface, tasks: readonly TrackedTask[]): Promise<Record<number, ReviewState>> {
  const values = await Promise.all(tasks.map(async task => {
    const root = `${task.cwd}/.pi/agent-review`
    const pendingFiles = await $.fs.list(`${root}/pending`).catch(() => [])
    const pending = [] as ReturnType<typeof parsePending>[]
    for (const file of pendingFiles) {
      if (file.kind !== 'file' || !file.name.endsWith('.json')) continue
      const parsed = parsePending(await $.fs.read(`${root}/pending/${file.name}`).catch(() => ''))
      if (parsed) pending.push(parsed)
    }
    const decisionFiles = await $.fs.list(`${root}/decisions`).catch(() => [])
    const decisions: unknown[] = []
    for (const file of decisionFiles) {
      if (file.kind !== 'file' || !file.name.endsWith('.json')) continue
      try { decisions.push(JSON.parse(await $.fs.read(`${root}/decisions/${file.name}`))) } catch { /* malformed decision is opaque */ }
    }
    return [task.id, reviewState(pending.filter((item): item is NonNullable<typeof item> => item !== undefined), decisions)] as const
  }))
  return Object.fromEntries(values)
}

export const register: Register = on => {
  registerBlast(on)
  registerClear(on)
  registerHandoff(on)
  registerPane(on)

  // The settings fallback only matters before the first prompt.compose names the style.
  let hasComposed = false
  let settingsStyle: Promise<string | null> | undefined

  on('session.start', async ($, e, next) => {
    captureSession(e.isInteractive)
    await $.command.register({ name: 'pi', description: 'Open Pi hand-off controls' })
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
    })
  })
}
