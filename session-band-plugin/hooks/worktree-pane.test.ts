import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const,
  surface: 'terminal' as const,
  requestId: 'worktrees',
  props: { title: 'Worktrees', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

const lines = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return []
  const value = node as { type?: string; children?: unknown[]; props?: { children?: unknown } }
  const children = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : Array.isArray(value.props.children) ? value.props.children : [value.props.children])]
  if (value.type === 'Text') return [children.filter(child => typeof child === 'string').join('')]
  return children.flatMap(lines)
}

test('the worktrees pane draws its title, then the tree, detail and legend as separate rows', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { TMPDIR: '/tmp' })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => {
    const args = e.argv.join(' ')
    const stdout = args.includes('worktree list') ? 'worktree /repo\nHEAD 1234567890\nbranch refs/heads/main\n\n' : args.includes('for-each-ref') ? 'main\t\t/repo\n' : ''
    return { value: { exitCode: args.includes('rev-list') ? 1 : 0, stdout, stderr: '' } } as never
  })

  await $.command.run({ command: 'worktrees', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })
  const rows = lines(await $.ui.render(PANE))
  expect(rows[0]).toBe('Worktrees')
  expect(rows).toContain('›repo  main')
  expect(rows).toContain('main · HEAD 1234567')
  expect(rows).toContain('⊘ detached  ⊗ prunable  › selected')
})
