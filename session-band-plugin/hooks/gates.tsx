import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import { acRunArgv, approveTimeoutMs, editRemoteArgv, parseSpecStatus, specRows, REVIEW_LIST_ARGV, parseReviewList, reviewRows, skipArgv, type GateRow, type SpecRow, type ReviewRow } from './gates'
import { approveArgv, approvalAction, matchingSocket, needsRejectConfirm, rejectToast, reviewRemoteArgv, reviewPaneRunArgv, reviewSplitArgv } from './pane.tsx'
import { JUMP_KEYS, nextPane, switchSteps } from './pane-nav'
import { PALETTE } from './palette'
import { parseWorktrees } from './worktrees'

export type GatesState = { rows: GateRow[]; headers: Record<string, string>; selected?: string; detail?: string; busy: string[]; last: Record<string, string>; confirm?: string; reviewsUnavailable?: boolean }
const view = atom({ plugin: 'session-band', key: 'gates' } as const, { rows: [], headers: {}, busy: [], last: {} } as GatesState)

const show = async ($: EngineInterface, row: SpecRow): Promise<string | undefined> => {
  const home = await $.env.get('HOME')
  if (!home) return undefined
  const result = await $.process.run(acRunArgv(home, 'show', row.path), { cwd: row.worktree }).catch(() => undefined)
  const detail = result?.exitCode === 0 ? result.stdout : undefined
  await update($, view, state => state.selected === row.key ? { ...state, detail } : state)
  return detail
}

const refresh = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const home = await $.env.get('HOME')
  const result = await $.process.run(['git', 'worktree', 'list', '--porcelain'], { cwd }).catch(() => undefined)
  const trees = result?.exitCode === 0 ? parseWorktrees(result.stdout) : []
  const specs = (await Promise.all(trees.map(async tree => {
    if (tree.detached || !tree.branch) return []
    const nested = await $.fs.list(`${tree.path}/specs`).catch(() => [])
    const rels = ['SPEC.md', ...nested.filter(file => file.kind === 'file' && file.name.endsWith('.md')).map(file => `specs/${file.name}`)]
    const files = await Promise.all(rels.map(async rel => ({ rel, text: await $.fs.read(`${tree.path}/${rel}`).catch(() => '') })))
    return Promise.all(specRows(tree, files).map(async row => {
      const status = home ? await $.process.run(acRunArgv(home, 'status', row.path), { cwd: tree.path }).catch(() => undefined) : undefined
      return { ...row, ...parseSpecStatus(status ?? { exitCode: 2, stdout: '', stderr: 'ac-run unavailable' }) }
    }))
  }))).flat()
  const reviews = home ? await $.process.run(REVIEW_LIST_ARGV(home), { cwd }).catch(() => undefined) : undefined
  const entries = reviews?.exitCode === 0 ? parseReviewList(reviews.stdout) : undefined
  const combined: GateRow[] = [...specs, ...reviewRows(entries ?? [])]
  // Selection follows the same owner-group order as the display; orphans are always last.
  const owners = [...new Set([...trees.map(tree => tree.path), ...combined.flatMap(row => row.worktree === null ? [] : [row.worktree])]), null]
  const rows = owners.flatMap(owner => combined.filter(row => row.worktree === owner))
  const headers = Object.fromEntries(trees.map(tree => [tree.path, tree.branch ?? tree.path.split('/').filter(Boolean).pop() ?? tree.path]))
  await update($, view, state => ({ ...state, rows, headers, reviewsUnavailable: entries === undefined, selected: rows.some(row => row.key === state.selected) ? state.selected : rows[0]?.key, detail: undefined, confirm: undefined }))
  const state = await read($, view)
  const pick = state.rows.find(row => row.key === state.selected)
  if (pick?.kind === 'spec') await show($, pick)
}

const move = async ($: EngineInterface, step: 1 | -1) => {
  await update($, view, state => {
    const at = Math.max(0, state.rows.findIndex(row => row.key === state.selected))
    return { ...state, selected: state.rows[(at + step + state.rows.length) % state.rows.length]?.key, detail: undefined, confirm: undefined }
  })
  const state = await read($, view)
  const pick = state.rows.find(row => row.key === state.selected)
  if (pick?.kind === 'spec') await show($, pick)
}

// Kept local because the engine cannot pass `$` across an import.
async function waitForSocket($: EngineInterface, socket: string): Promise<boolean> {
  if (await $.fs.exists(socket)) return true
  return new Promise(resolve => {
    let attempts = 0
    const timer = $.clock.every(100, async () => {
      const exists = await $.fs.exists(socket)
      attempts += 1
      if (exists || attempts >= 30) { timer.cancel(); resolve(exists) }
    })
  })
}

async function socketFor($: EngineInterface, repo: string): Promise<string> {
  const tmp = await $.env.get('TMPDIR') ?? '/tmp'
  const user = await $.env.get('USER') ?? 'user'
  const found = await $.process.run(['fd', '-HI', '--type', 's', '^nvim\\..*\\.0$', `${tmp.replace(/\/$/, '')}/nvim.${user}`]).catch(() => ({ stdout: '' }))
  const candidates: { path: string; cwd: string }[] = []
  for (const path of found.stdout.split('\n').filter(Boolean)) {
    const cwd = await $.process.run(['nvim', '--server', path, '--remote-expr', 'getcwd()'])
    if (cwd.exitCode === 0) candidates.push({ path, cwd: cwd.stdout.trim() })
  }
  const existing = matchingSocket(repo, candidates)
  if (existing) return existing
  const split = await $.process.run(reviewSplitArgv(repo))
  let pane: string | undefined
  try { pane = JSON.parse(split.stdout).result?.pane?.pane_id as string | undefined } catch { /* unavailable */ }
  if (!pane) throw new Error('could not open Neovim pane')
  const socket = `${tmp.replace(/\/$/, '')}/nvim.${user}/pi-review-${Date.now()}.sock`
  await $.process.run(reviewPaneRunArgv(pane, socket))
  if (await waitForSocket($, socket)) return socket
  throw new Error('Neovim did not start')
}

const edit = async ($: EngineInterface, row: GateRow | undefined) => {
  if (row?.kind !== 'spec') return
  try {
    const socket = await socketFor($, row.worktree)
    const result = await $.process.run(editRemoteArgv(socket, row.path))
    if (result.exitCode !== 0) throw new Error('remote edit failed')
  } catch { await $.ui.toast('Could not open the spec in Neovim.') }
}

const openReview = async ($: EngineInterface, row: GateRow | undefined, message?: string) => {
  if (row?.kind !== 'review' || row.entry.orphan || !row.worktree) return
  try {
    const socket = await socketFor($, row.worktree)
    const result = await $.process.run(reviewRemoteArgv(socket, 'AgentReview'))
    if (result.exitCode !== 0) throw new Error('remote review failed')
    if (message) await $.ui.toast(message)
  } catch { await $.ui.toast('Could not open review.') }
}

const approveReview = async ($: EngineInterface, row: ReviewRow) => {
  const home = await $.env.get('HOME')
  if (!home) { await $.ui.toast('Review gate not available.'); return }
  const result = await $.process.run(approveArgv(home, row.entry.runId), { cwd: await $.session.cwd(), timeoutMs: 60_000 }).catch(() => undefined)
  const action = result ? approvalAction(result.stdout) : 'unavailable'
  if (action === 'unavailable') { await $.ui.toast('Review gate not available.'); return }
  if (action === 'approved') { await $.ui.toast('Review approved.'); return }
  let message: string | undefined
  try { message = (JSON.parse(result!.stdout) as { message?: string }).message } catch { /* outcome already parsed */ }
  if (action === 'open-review') { await openReview($, row, message ?? 'Tree changed; opening review.'); return }
  await $.ui.toast(message ?? 'Review approval refused.')
}

const approve = async ($: EngineInterface, row: GateRow | undefined) => {
  if (!row) return
  if (row.kind === 'spec' && (row.state === 'invalid' || row.state === 'approved')) return
  if (row.kind === 'review' && (row.entry.processing || row.entry.orphan)) return
  // Claim before any process or detail read; a second press sees the busy row.
  let claimed = false
  await update($, view, state => {
    if (state.busy.includes(row.key)) return state
    claimed = true
    return { ...state, busy: [...state.busy, row.key], confirm: undefined }
  })
  if (!claimed) return
  let message = 'ac-run unavailable'
  try {
    if (row.kind === 'review') {
      await approveReview($, row)
      message = ''
    } else {
      const home = await $.env.get('HOME')
      const detail = await show($, row)
      if (home && detail !== undefined) {
        const count = detail.split('\n').filter(line => line.trimStart().startsWith('runs:')).length
        const result = await $.process.run(acRunArgv(home, 'approve', row.path), { cwd: row.worktree, timeoutMs: approveTimeoutMs(count) })
        message = (result.stdout.trim() || result.stderr.trim()).split('\n').filter(Boolean).pop() ?? 'not approved'
      }
    }
  } catch { message = 'Approval process unavailable or timed out.' }
  finally {
    await update($, view, state => ({ ...state, busy: state.busy.filter(key => key !== row.key), last: { ...state.last, [row.key]: message } }))
    await refresh($)
  }
}

const reject = async ($: EngineInterface, row: GateRow | undefined) => {
  if (!row) return
  const state = await read($, view)
  if (state.busy.includes(row.key)) return
  if (needsRejectConfirm(state.confirm, row.key)) {
    await update($, view, value => ({ ...value, confirm: row.key }))
    await $.ui.toast(row.kind === 'review' ? 'Press Reject all again to confirm.' : 'Press Reject again to confirm.')
    return
  }
  await update($, view, value => ({ ...value, confirm: undefined }))
  if (row.kind === 'review') {
    try {
      if (row.entry.orphan) {
        const home = await $.env.get('HOME')
        if (!home) throw new Error('review gate unavailable')
        const result = await $.process.run(skipArgv(home, row.entry.runId), { cwd: await $.session.cwd() })
        let message: string | undefined
        try { message = (JSON.parse(result.stdout) as { message?: string }).message } catch { /* use exit status */ }
        await $.ui.toast(message ?? (result.exitCode === 0 ? 'Skipped.' : 'Could not skip review.'))
      } else if (row.worktree) {
        const socket = await socketFor($, row.worktree)
        const result = await $.process.run(reviewRemoteArgv(socket, 'AgentReviewRejectAll', row.entry.runId))
        await $.ui.toast(rejectToast(result.exitCode))
      }
    } catch { await $.ui.toast(row.entry.orphan ? 'Could not skip review.' : rejectToast(1)) }
  } else {
    const home = await $.env.get('HOME')
    if (!home) { await $.ui.toast('ac-run unavailable'); return }
    const result = await $.process.run(acRunArgv(home, 'reject', row.path), { cwd: row.worktree }).catch(() => undefined)
    const message = (result?.stdout.trim() || result?.stderr.trim() || 'Reject unavailable').split('\n').pop() ?? 'Reject unavailable'
    await update($, view, value => ({ ...value, last: { ...value.last, [row.key]: message } }))
  }
  await refresh($)
}

const goTo = async ($: EngineInterface, to: string | undefined) => {
  for (const step of switchSteps('gates', to)) await ('close' in step ? $.ui.close({ id: step.close }) : $.ui.open({ id: step.open, title: step.title, focus: step.focus }))
}
const cycle = async ($: EngineInterface, step: 1 | -1) => goTo($, nextPane((await $.ui.panes()).map(pane => pane.id), 'gates', step))

export const register: Register = on => {
  on('command.run', { command: 'gates' }, async ($, _e, _next) => {
    await $.ui.open({ id: 'gates', title: 'Gates', focus: true })
    return { text: 'Gates opened.' }
  })
  on('ui.open', { id: 'gates' }, async ($, e, next) => { const result = await next(e); await refresh($); return result })
  on('ui.render', { component: 'Pane', requestId: 'gates' }, async ($, e, _next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, view)
    const pick = state.rows.find(row => row.key === state.selected)
    const owners = [...new Set(state.rows.map(row => row.worktree))]
    return <Box flexDirection="column">
      <Text weight="bold">Gates</Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}>
        <Button key="gates-key-down" plain dimColor hotkey="j" label="down" onPress={() => void move($, 1)} />
        <Button key="gates-key-up" plain dimColor hotkey="k" label="up" onPress={() => void move($, -1)} />
        <Button key="gates-approve" plain dimColor={!pick || (pick.kind === 'spec' ? pick.state === 'invalid' || pick.state === 'approved' : pick.entry.processing || pick.entry.orphan) || state.busy.includes(pick.key)} hotkey="a" label="Approve" onPress={() => void approve($, pick)} />
        <Button key="gates-reject" plain hotkey="x" label={state.confirm === pick?.key && pick ? 'Reject again?' : pick?.kind === 'review' ? 'Reject all' : 'Reject'} onPress={() => void reject($, pick)} />
        <Button key="gates-edit" plain hotkey="e" label="Edit" onPress={() => void edit($, pick)} />
        <Button key="gates-open" plain hotkey="o" label="Open review" onPress={() => void openReview($, pick)} />
        <Button key="gates-key-reload" plain dimColor hotkey="r" label="refresh" onPress={() => void refresh($)} />
        <Button key="gates-key-prev" plain dimColor hotkey="b" label="prev" onPress={() => void cycle($, -1)} />
        <Button key="gates-key-next" plain dimColor hotkey="f" label="next" onPress={() => void cycle($, 1)} />
        <Button key="gates-key-worktrees" plain dimColor hotkey="w" label="worktrees" onPress={() => void goTo($, 'worktrees')} />
        <Button key="gates-key-quit" plain dimColor hotkey="q" label="close" onPress={() => void $.ui.close({ id: 'gates' })} />
        {JUMP_KEYS.map(j => <Button key={`gates-key-jump-${j.key}`} plain dimColor hotkey={j.key} label={j.label} onPress={() => void (j.id === 'gates' ? undefined : goTo($, j.id))} />)}
      </Box>
      {state.reviewsUnavailable && <Text color={PALETTE.yellow}>reviews unavailable</Text>}
      {state.rows.length === 0 && <Text dimColor>No specs or pending reviews.</Text>}
      {owners.map(owner => <Box key={`gates-group-${owner}`} flexDirection="column" marginBottom={1}>
        <Text weight="bold">{owner === null ? '(no worktree)' : state.headers[owner] ?? owner.split('/').filter(Boolean).pop() ?? owner}</Text>
        {state.rows.filter(row => row.worktree === owner).map(row => {
          if (row.kind === 'review') {
            const entry = row.entry
            const parts = [`review ${entry.runId.slice(0, 8)}`, entry.name, ...(['landed', 'processing', 'error', 'orphan'] as const).filter(tag => entry[tag]).map(tag => `[${tag}]`)]
            if (state.busy.includes(row.key)) parts.push('approving…')
            return <Text key={row.key} mono weight={row.key === state.selected ? 'bold' : undefined}>{`${row.key === state.selected ? '›' : ' '} ${parts.filter(Boolean).join('  ')}`}</Text>
          }
          const color = row.state === 'approved' ? PALETTE.green : row.state === 'draft' ? PALETTE.yellow : PALETTE.red
          const note = state.busy.includes(row.key) ? 'approving…' : state.last[row.key] ?? row.error
          return <Text key={row.key} mono color={color} weight={row.key === state.selected ? 'bold' : undefined}>{`${row.key === state.selected ? '›' : ' '} ${row.rel}  ${row.state ?? 'draft'}${note ? `  ${note}` : ''}`}</Text>
        })}
      </Box>)}
      {pick?.kind === 'spec' && state.detail?.split('\n').map((line, i) => <Text key={`gates-detail-${i}`} mono dimColor>{line}</Text>)}
    </Box>
  })
}
