import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import type { Usage } from '../types'
import { drawBand } from './band'
import { shortDir, shortModel, whole } from './format'
import { guardAgent, softStop, type SoftStopCheck } from './threshold'

const usage = atom({ plugin: 'session-band', key: 'usage' } as const, {})
const git = atom({ plugin: 'session-band', key: 'git' } as const, null)
const outputStyle = atom({ plugin: 'session-band', key: 'outputStyle' } as const, null)
const isNotified = atom({ plugin: 'session-band', key: 'isNotified' } as const, false)

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

  if (!branch) {
    await update($, git, () => null)
    return
  }

  const [unstaged, staged, upstream, stash, gitDir, common] = await Promise.all([
    $.process.run(['git', '-C', cwd, '--no-optional-locks', 'diff', '--quiet']),
    $.process.run(['git', '-C', cwd, '--no-optional-locks', 'diff', '--cached', '--quiet']),
    run(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]),
    run(['stash', 'list']),
    run(['rev-parse', '--absolute-git-dir']),
    run(['rev-parse', '--path-format=absolute', '--git-common-dir']),
  ])
  const counts = upstream && await run(['rev-list', '--left-right', '--count', `${upstream}...HEAD`])
  const [behind = 0, ahead = 0] = (counts || '').split(/\s+/).map(Number)
  const isLinked = !!gitDir && !!common && gitDir !== common

  await update($, git, () => ({
    branch,
    isDirty: unstaged.exitCode !== 0 || staged.exitCode !== 0,
    ahead,
    behind,
    hasUpstream: !!upstream,
    stash: stash ? stash.split('\n').length : 0,
    worktree: isLinked ? gitDir.split('/').pop()?.replace(/^worktree-/, '') : undefined,
  }))
}

const resolveRepo = async ($: EngineInterface) => {
  const git = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  const [top, common] = git.stdout.trim().split('\n')

  if (git.exitCode !== 0 || !top || !common) return {}

  const mainRepo = common.slice(0, common.lastIndexOf('/'))
  const taskId = (await $.fs.read(`${top}/.agent-task-id`).catch(() => '')).trim() || undefined

  return {
    taskId,
    statePath: taskId
      ? `${mainRepo}/.agents/claimed/${taskId}.state.md`
      : `${mainRepo}/.claude/session-state.md`,
  }
}

const settingStyle = async ($: EngineInterface): Promise<string | null> => {
  const settings = await $.settings.read()
  const style = settings.outputStyle

  return typeof style === 'string' ? style : null
}

const styleForBand = (style: string | null) => (style === 'default' ? null : style)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
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

    if (e.tool === 'Bash') await refreshGit($).catch(() => undefined)
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
    await update($, outputStyle, () => e.outputStyle?.name ?? null)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [cwd, home, model, currentUsage, currentGit, capturedStyle] = await Promise.all([
      $.session.cwd(),
      $.env.get('HOME'),
      $.session.model(),
      read($, usage),
      read($, git),
      read($, outputStyle),
    ])
    const style = styleForBand(capturedStyle ?? await settingStyle($).catch(() => null))

    return drawBand($.ui.resolve(e), {
      dir: shortDir(cwd, home),
      model: shortModel(model),
      usage: currentUsage,
      git: currentGit,
      style,
    })
  })
}
