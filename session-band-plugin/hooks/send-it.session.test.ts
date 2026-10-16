import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

const HOME = '/Users/test'
const REPO = '/work/repo'
const RULE = `${HOME}/.claude/rules/send-it.md`
const LOCAL = `${REPO}/.claude/settings.local.json`
const RULE_TEXT = '# send-it rules\nDo not ask questions.'
const MISSING = 'is missing or unreadable'
const REFUSED = 'applies at the next session start'
const PANE_HEADER = 'send-it ON · dontAsk · sandbox · auto-merge'
const START = { cwd: REPO, surface: 'terminal' as const, isInteractive: true }
const ON_TEXT = '{"env": {"SEND_IT": "1"}, "permissions": {"defaultMode": "dontAsk"}}\n'
const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

type World = { files: Record<string, string>; loaded: Record<string, unknown>; toasts: string[] }

const setup = (on: On, over: Partial<World> = {}): World => {
  const world: World = { files: { [RULE]: RULE_TEXT, [LOCAL]: ON_TEXT }, loaded: {}, toasts: [], ...over }

  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME, TMPDIR: '/tmp' })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 10 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: REPO }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('settings.read', ($, e) => ({ value: (e.source === 'local' ? world.loaded : {}) as never }))
  on('classic.SessionStart', () => ({}))
  on('classic.ConfigChange', () => ({}))
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('process.run', ($, e) => {
    const argv = e.argv.join(' ')
    if (argv.includes('--show-toplevel')) return { value: ok(`${REPO}\n`) }
    if (argv.includes('worktree list')) return { value: ok(`worktree ${REPO}\nHEAD 1234567890\nbranch refs/heads/main\n\n`) }
    if (argv.includes('for-each-ref')) return { value: ok(`main\t\t${REPO}\n`) }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', ($, e) => ({ value: (e.path in world.files) as never }))
  on('fs.read', ($, e) => {
    if (!(e.path in world.files)) throw new Error('ENOENT')
    return { value: world.files[e.path] as never }
  })
  on('fs.write', ($, e) => {
    world.files[e.path] = e.text
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  return world
}

const sendItOnLoaded = { env: { SEND_IT: '1' }, permissions: { defaultMode: 'dontAsk' } }

// The header draws only above a tree, so the pane is opened first with one worktree listed.
const paneText = async ($: Engine) => {
  await $.command.run({ command: 'worktrees', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })
  const node = await $.ui.render({
    component: 'Pane' as const,
    surface: 'terminal' as const,
    requestId: 'worktrees',
    props: { title: 'Worktrees', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  return JSON.stringify(node)
}

test('send-it on at start: the rule text is injected as session context', async ($, on) => {
  const world = setup(on, { loaded: sendItOnLoaded })
  await $.session.start(START)

  const result = await $.classic.SessionStart({ source: 'startup' })

  expect(result.additionalContext).toEqual([RULE_TEXT])
  expect(world.toasts).toEqual([])
})

test('only one of the two keys leaves send-it off: nothing is injected', async ($, on) => {
  setup(on, { loaded: { env: { SEND_IT: '1' } } })
  await $.session.start(START)

  const result = await $.classic.SessionStart({ source: 'startup' })

  expect(result.additionalContext).toBeUndefined()
  expect(await paneText($)).not.toContain(PANE_HEADER)
})

test('send-it on with no rule file: a visible toast and a model warning, not silence', async ($, on) => {
  const world = setup(on, { loaded: sendItOnLoaded })
  delete world.files[RULE]
  await $.session.start(START)

  const result = await $.classic.SessionStart({ source: 'startup' })

  expect(world.toasts.join('\n')).toContain(MISSING)
  expect(result.additionalContext?.join('\n')).toContain(MISSING)
  expect(result.additionalContext?.join('\n')).not.toContain(RULE_TEXT)
})

test('ConfigChange on a local or user settings file is blocked while send-it runs', async ($, on) => {
  setup(on, { loaded: sendItOnLoaded })
  await $.session.start(START)

  const local = await $.classic.ConfigChange({ source: 'local_settings' })
  const user = await $.classic.ConfigChange({ source: 'user_settings' })

  expect(local.block).toContain(REFUSED)
  expect(user.block).toContain(REFUSED)
})

test('ConfigChange is passed through while send-it is off and the block is absent', async ($, on) => {
  setup(on, { files: { [RULE]: RULE_TEXT, [LOCAL]: '{}\n' } })
  await $.session.start(START)

  const result = await $.classic.ConfigChange({ source: 'local_settings' })

  expect(result.block).toBeUndefined()
})

test('ConfigChange is blocked when the block is on disk, even though this session started off', async ($, on) => {
  setup(on, { files: { [RULE]: RULE_TEXT, [LOCAL]: ON_TEXT } })
  await $.session.start(START)

  const result = await $.classic.ConfigChange({ source: 'local_settings' })

  expect(result.block).toContain(REFUSED)
})

test('ConfigChange on a project settings file is never blocked', async ($, on) => {
  setup(on, { loaded: sendItOnLoaded })
  await $.session.start(START)

  const result = await $.classic.ConfigChange({ source: 'project_settings' })

  expect(result.block).toBeUndefined()
})

test('the worktrees pane shows the send-it header when the atom is on', async ($, on) => {
  setup(on, { loaded: sendItOnLoaded })
  await $.session.start(START)

  expect(await paneText($)).toContain(PANE_HEADER)
})
