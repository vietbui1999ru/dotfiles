import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

const MODEL_REPLY = [
  'GOAL: Ship the session-band clear hook',
  '## Completed',
  '- wired the hook',
  '## In Progress',
  '- nothing',
  '## Decisions Made',
  '- nothing',
  '## Blocked / Needs Input',
  '- nothing',
  '## Files Modified This Session',
  '- hooks/clear.tsx',
  '## Next Session Should',
  '- live test',
].join('\n')

type Message = {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool: string; input: Record<string, unknown> }[]
  toolResults?: { isError?: boolean; text: string }[]
}

const user = (text: string): Message => ({ role: 'user', text, toolUses: [] })
const assistant = (text: string, toolUses: Message['toolUses'] = []): Message => ({ role: 'assistant', text, toolUses })

type World = {
  taskId: string
  common: string
  messages: Message[]
  sessions: { name: string; mtimeMs: number }[]
  model: { isAnswered: true; text: string } | { isAnswered: false; reason: 'empty-reply' }
  askAnswer: 'Clear anyway' | 'Cancel' | undefined
  clearRan: number
  toasts: string[]
  writes: { path: string; text: string }[]
  modelPrompt?: string
  askQuestion?: string
  saveGoal?: string
  saveStdin?: string
}

const setup = (on: On, over: Partial<World> = {}): World => {
  const world: World = {
    taskId: '',
    common: '/work/.git',
    messages: [user('fix the clear hook'), assistant('done')],
    sessions: [],
    model: { isAnswered: true, text: MODEL_REPLY },
    askAnswer: 'Clear anyway',
    clearRan: 0,
    toasts: [],
    writes: [],
    ...over,
  }

  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })

  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 0 }, rateLimits: [] } } as never))
  on('session.messages', () => ({ value: world.messages as never }))
  on('session.root', () => ({ value: '/work' }))

  on('process.run', ($, e) => {
    const argv = e.argv
    if (argv[0] === 'git') {
      return { value: { exitCode: 0, stdout: `/work\n${world.common}`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv[0] === 'agent-session' && argv[1] === 'path') {
      return { value: { exitCode: 0, stdout: '/work/.agents/sessions', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv[0] === 'agent-session' && argv[1] === 'save') {
      const goalIndex = argv.indexOf('--goal')
      world.saveGoal = goalIndex >= 0 ? argv[goalIndex + 1] : undefined
      world.saveStdin = e.init?.stdin
      return { value: { exitCode: 0, stdout: '✓ Saved: .agents/sessions/20261007_cc_general_goal.md', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv[0] === 'agent-session' && argv[1] === 'active') {
      return { value: { exitCode: 0, stdout: '.agents/sessions/20261007_cc_general_goal.md', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  on('fs.read', ($, e) => ({ value: e.path.endsWith('.agent-task-id') ? world.taskId : '' }))
  on('fs.stat', () => { throw new Error('ENOENT') })
  on('fs.list', () => ({ value: world.sessions.map(s => ({ name: s.name, kind: 'file', size: 10, mtimeMs: s.mtimeMs, isLink: false })) as never }))
  on('fs.write', ($, e) => {
    world.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('model.complete', ($, e) => {
    world.modelPrompt = e.prompt
    return { value: world.model as never }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      if (world.askAnswer === undefined) throw new Error('dismissed')
      const question = (e as { questions: { question: string }[] }).questions[0]?.question ?? ''
      world.askQuestion = question
      return { result: { answers: { [question]: world.askAnswer } } } as never
    }
    return { result: 'ok', text: 'ok' }
  })
  on('command.run', () => {
    world.clearRan += 1
    return { text: 'cleared' }
  })
  on('prompt.submit', () => ({ text: 'ok' }))

  return world
}

const clear = (origin: 'composer' | 'sdk' = 'composer') => ({
  command: 'clear',
  args: '',
  origin: { kind: origin },
  presentation: { isFullscreen: true, columns: 180 },
})

const edit = async ($: Engine) => {
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
}

test('a trivial session passes straight to the built-in clear', async ($, on) => {
  const world = setup(on)

  const result = await $.command.run(clear())

  expect(result.text).toBe('cleared')
  expect(world.clearRan).toBe(1)
  expect(world.modelPrompt).toBeUndefined()
  expect(world.writes).toEqual([])
  expect(world.toasts).toEqual([])
  expect(world.askQuestion).toBeUndefined()
})

test('real work is summarised, saved, saved, cleared, then reported', async ($, on) => {
  const world = setup(on, {
    messages: [user('fix the clear hook'), assistant('done', [{ tool: 'Edit', input: { file_path: '/work/a.ts' } }])],
  })

  await edit($)
  const result = await $.command.run(clear())

  expect(result.text).toBe('Session saved: .agents/sessions/20261007_cc_general_goal.md')
  expect(world.clearRan).toBe(1)
  expect(world.modelPrompt).toContain('fix the clear hook')
  expect(world.modelPrompt).toContain('/work/a.ts')
  expect(world.saveGoal).toBe('Ship the session-band clear hook')
  expect(world.saveStdin).toContain('## Completed')
  expect(world.saveStdin).toContain('## Next Session Should')
})

test('a failed save asks, and Clear anyway clears', async ($, on) => {
  const world = setup(on, { model: { isAnswered: false, reason: 'empty-reply' }, askAnswer: 'Clear anyway' })

  await edit($)
  const result = await $.command.run(clear())

  expect(world.askQuestion).toContain('Save failed')
  expect(world.askQuestion).toContain('Clear anyway?')
  expect(result.text).toBe('cleared')
  expect(world.clearRan).toBe(1)
  expect(world.toasts).toEqual([])
  expect(world.saveStdin).toBeUndefined()
})

test('Cancel refuses the clear and saves nothing', async ($, on) => {
  const world = setup(on, { model: { isAnswered: false, reason: 'empty-reply' }, askAnswer: 'Cancel' })

  await edit($)
  const result = await $.command.run(clear())

  expect(result.text).toContain('Clear cancelled: nothing was saved.')
  expect(world.clearRan).toBe(0)
  expect(world.toasts).toEqual([])
  expect(world.saveStdin).toBeUndefined()
})

test('an empty transcript with real work refuses instead of clearing', async ($, on) => {
  const world = setup(on, { messages: [] })

  await edit($)
  const result = await $.command.run(clear())

  expect(result.text).toContain('Clear refused')
  expect(world.clearRan).toBe(0)
  expect(world.modelPrompt).toBeUndefined()
})

test('a save in the last five minutes skips the duplicate', async ($, on) => {
  const world = setup(on, { sessions: [{ name: 'recent.md', mtimeMs: 999_000 }] })

  await edit($)
  const result = await $.command.run(clear())

  expect(result.text).toBe('cleared')
  expect(world.clearRan).toBe(1)
  expect(world.modelPrompt).toBeUndefined()
  expect(world.saveStdin).toBeUndefined()
})

test('a non-composer clear refuses on failure instead of asking', async ($, on) => {
  const world = setup(on, { model: { isAnswered: false, reason: 'empty-reply' } })

  await edit($)
  const result = await $.command.run(clear('sdk'))

  expect(result.text).toContain('Clear cancelled: nothing was saved.')
  expect(world.clearRan).toBe(0)
  expect(world.askQuestion).toBeUndefined()
})

test('a task worktree writes the claimed state file', async ($, on) => {
  const world = setup(on, { taskId: 'TASK-7', common: '/main/.git' })

  await edit($)
  const result = await $.command.run(clear())

  expect(result.text).toBe('Session saved: /main/.agents/claimed/TASK-7.state.md')
  expect(world.clearRan).toBe(1)
  expect(world.writes).toHaveLength(1)
  expect(world.writes[0]?.path).toBe('/main/.agents/claimed/TASK-7.state.md')
  expect(world.writes[0]?.text).toContain('status: active')
  expect(world.writes[0]?.text).toContain('agent_task: TASK-7')
  expect(world.writes[0]?.text).toContain('## Completed')
  expect(result.text).toBe('Session saved: /main/.agents/claimed/TASK-7.state.md')
  expect(world.saveStdin).toBeUndefined()
})

test('four prompts count as real work', async ($, on) => {
  const world = setup(on)

  for (let index = 0; index < 4; index += 1) {
    await $.prompt.submit({ text: `prompt ${index}` })
  }
  const result = await $.command.run(clear())

  expect(result.text).toStartWith('Session saved: ')
  expect(world.clearRan).toBe(1)
  expect(world.modelPrompt).toBeDefined()
})
