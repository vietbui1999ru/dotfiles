import { expect, mock, test } from 'claude-code/testing'

const command = { command: 'pi-history', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
const PANE = {
  component: 'Pane' as const,
  surface: 'terminal' as const,
  requestId: 'pi-history',
  props: { title: 'Pi history', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

const status = JSON.stringify({ tasks: { '7': {
  id: 7, label: 'sim-done', path: '/repo', created_at: '2026-10-10T11:00:00Z',
  command: 'pi --model opencode-go/flash:high --session-id pueue-sim-done -p x < /dev/null',
  status: { Done: { enqueued_at: '2026-10-10T11:00:00Z', start: '2026-10-10T11:00:01Z', end: '2026-10-10T11:00:05Z', result: 'Success' } },
} } })

// Each lazy usage load writes the history state, and every write redraws the pane. A load started
// by a redraw whose result is already cached must not write again, or the pane redraws forever.
for (const files of [
  { name: 'a session file', entries: [{ name: '2026-10-10T11-00-01-000Z_pueue-sim-done.jsonl', kind: 'file', size: 2, mtimeMs: 5 }] },
  { name: 'no session file', entries: [] },
]) {
  test(`redrawing history with ${files.name} does not look the usage up again`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
    mock.env(on, { HOME: '/Users/test' })
    on('ui.open', () => ({ value: { isPlaced: true } } as never))
    let lookups = 0
    on('fs.list', (_$, e) => {
      if (e.path.includes('/.pi/agent/sessions/')) lookups += 1
      return { value: e.path.includes('/.pi/agent/sessions/') ? files.entries : [] } as never
    })
    on('fs.stat', () => ({ value: { size: 2, mtimeMs: 5, kind: 'file' } } as never))
    on('process.run', (_$, e) => {
      if (e.argv[0] === 'pueue') return { value: { exitCode: 0, stdout: status, stderr: '' } } as never
      if (e.argv[0] === 'sh') return { value: { exitCode: 0, stdout: '{}\n', stderr: '' } } as never
      return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
    })

    await $.command.run(command)
    await clock.advance(0)
    const opened = lookups
    for (let draw = 0; draw < 4; draw += 1) {
      await $.ui.render(PANE)
      await clock.advance(0)
    }

    expect(opened).toBeGreaterThan(0)
    expect(lookups).toBe(opened)
  })
}
