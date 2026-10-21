import { expect, mock, test } from 'claude-code/testing'

import {
  judge,
  newestFirst,
  parseBlocks,
  parseVerdicts,
  pendingCount,
  safetyBlockLine,
  safetyLogArgv,
  sessionRows,
  stateDir,
  type SafetyBlock,
  type SafetyBlockRow,
} from './safety-blocks'

const STATE = '/h/.claude/state'
const LOG = `${STATE}/bash-safety-blocks.jsonl`
const ROTATED = `${LOG}.1`
const VERDICTS = `${STATE}/bash-safety-verdicts.jsonl`
const START = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const BAND = {
  component: 'AbovePrompt' as const,
  surface: 'terminal' as const,
  requestId: 'session-band',
  props: { hasSurvey: false, isWorking: false, maxRows: 1, bodyColumns: 160, scroll: { offset: 0, bodyRows: 1 }, view: {} },
}
const PANE = {
  component: 'Pane' as const,
  surface: 'terminal' as const,
  requestId: 'safety-blocks',
  props: { title: 'Blocks', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

/** One log line as the hook writes it, with any field overridden. */
const entry = (id: string, over: Partial<SafetyBlock> = {}): string => JSON.stringify({
  id,
  ts: '2026-10-21T16:02:11+07:00',
  session: 's1',
  cwd: '/work/w',
  transcript: '/t/s1.jsonl',
  rule: 'git-clean-force',
  command: 'git clean -fd',
  reason: 'BLOCKED: git clean -f',
  ...over,
})

const verdict = (id: string, value: 'ok' | 'false-positive'): string =>
  JSON.stringify({ id, verdict: value, ts: '2026-10-21T16:03:11+07:00' })

const lines = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return []
  const value = node as { type?: string; children?: unknown[]; props?: { children?: unknown } }
  const children = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : Array.isArray(value.props.children) ? value.props.children : [value.props.children])]
  if (value.type === 'Text') return [children.filter(child => typeof child === 'string').join('')]
  return children.flatMap(lines)
}

// The chip is a Button, so its text lives in the label prop, not in a Text child.
const labels = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return []
  const value = node as { children?: unknown[]; props?: { children?: unknown; label?: unknown } }
  const own = typeof value.props?.label === 'string' ? [value.props.label] : []
  const children = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : Array.isArray(value.props.children) ? value.props.children : [value.props.children])]
  return [...own, ...children.flatMap(labels)]
}

/** A fake state dir: `files` is read through fs.read, and the band and panes see what a mark appended. */
const state = (on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>) => {
  on('fs.read', (_$, e) => {
    const body = files[e.path]
    if (body === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: body } as never
  })
  const calls: string[][] = []
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    if (e.argv[1] === 'mark') files[VERDICTS] = `${files[VERDICTS] ?? ''}${verdict(e.argv[2] ?? '', e.argv[3] === 'ok' ? 'ok' : 'false-positive')}\n`
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  return { calls }
}

test('a block line is parsed, judged by the last verdict, and listed newest first', () => {
  const blocks = parseBlocks([
    `${entry('aaa111bbb222', { ts: '2026-10-21T10:00:00+07:00' })}\nnot json\n{"no":"id"}\n`,
    entry('bbb222ccc333', { ts: '2026-10-21T16:02:11+07:00' }),
  ])
  expect(blocks.map(block => block.id)).toEqual(['aaa111bbb222', 'bbb222ccc333'])
  expect(newestFirst(blocks).map(block => block.id)).toEqual(['bbb222ccc333', 'aaa111bbb222'])
  expect(parseVerdicts(`${verdict('aaa111bbb222', 'ok')}\n${verdict('aaa111bbb222', 'false-positive')}\n`).get('aaa111bbb222')).toBe('false-positive')
  const rows = judge(newestFirst(blocks), parseVerdicts(`${verdict('bbb222ccc333', 'ok')}\n`))
  expect(rows.map(row => row.verdict)).toEqual(['ok', undefined])
  expect(pendingCount(rows)).toBe(1)
  expect(sessionRows(rows, 's1')).toHaveLength(2)
  expect(sessionRows(rows, 's2')).toHaveLength(0)
  const row: SafetyBlockRow = { ...blocks[0]!, command: 'git   clean\n-fd' }
  expect(safetyBlockLine(row)).toBe('10:00:00  git-clean-force  pending  git clean -fd')
  expect(safetyLogArgv('/h', 'aaa111bbb222', 'false-positive')).toEqual(['/h/dotfiles/scripts/safety-log', 'mark', 'aaa111bbb222', 'false-positive'])
})

test("safety blocks chip counts this session's pending blocks", async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/h' })
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.model', () => ({ value: 'opus' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 10 }, rateLimits: [] } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: {} }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const files: Record<string, string> = {
    [LOG]: [entry('aaaa11112222'), entry('bbbb33334444'), entry('cccc55556666'), entry('dddd77778888', { session: 's2' })].join('\n') + '\n',
    [VERDICTS]: `${verdict('cccc55556666', 'ok')}\n`,
  }
  state(on, files)
  await $.session.start(START)

  // Two of this session's four blocks are unjudged; the other session's block does not count.
  expect(labels(await $.ui.render(BAND))).toContain('⛔2')

  // Judging them clears the chip: it never shows when there is nothing pending.
  files[VERDICTS] += `${verdict('aaaa11112222', 'ok')}\n${verdict('bbbb33334444', 'false-positive')}\n`
  const shown = labels(await $.ui.render(BAND))
  expect(shown.some(label => label.startsWith('⛔'))).toBe(false)
})

test('blocks pane marks the selected block', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/h' })
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('ui.toast', () => ({ value: undefined } as never))
  const files: Record<string, string> = {
    [LOG]: [
      entry('aaa111bbb222', { ts: '2026-10-21T16:02:11+07:00' }),
      entry('bbb222ccc333', { ts: '2026-10-21T16:01:11+07:00', rule: 'force-push-main', command: 'git push -f origin main' }),
    ].join('\n') + '\n',
    [ROTATED]: entry('ccc333ddd444', { ts: '2026-10-21T15:00:11+07:00', session: 's2' }),
  }
  const { calls } = state(on, files)
  await $.command.run({ command: 'blocks', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })

  // This session's blocks only, newest first, the newest selected.
  const rows = lines(await $.ui.render(PANE))
  expect(rows).toContain('Blocks')
  expect(rows.some(row => row.includes('16:02:11') && row.includes('git clean -fd') && row.includes('pending'))).toBe(true)
  expect(rows.some(row => row.includes('ccc333ddd444'))).toBe(false)

  // f records a false positive through the CLI, then the list refreshes with the verdict.
  await ui.press({ key: 'sb-key-false-positive' })
  await clock.settle()
  expect(calls).toEqual([safetyLogArgv('/h', 'aaa111bbb222', 'false-positive')])
  expect(lines(await $.ui.render(PANE)).some(row => row.includes('git clean -fd') && row.includes('false-positive'))).toBe(true)

  // j moves to the older block; o records the other verdict through the same command.
  await ui.press({ key: 'sb-key-down' })
  await clock.settle()
  await ui.press({ key: 'sb-key-ok' })
  await clock.settle()
  expect(calls[1]).toEqual(safetyLogArgv('/h', 'bbb222ccc333', 'ok'))
  expect(lines(await $.ui.render(PANE)).some(row => row.includes('git push -f origin main') && row.includes('ok'))).toBe(true)
})

test('an empty SAFETY_LOG_DIR counts as unset, as it does for the hook', () => {
  expect(stateDir('/h', '')).toBe(STATE)
  expect(stateDir('/h', '/logs')).toBe('/logs')
})
