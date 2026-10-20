import { expect, mock, test } from 'claude-code/testing'

const panes = [
  { id: 'pi-handoff', prefix: 'pi-key', title: 'Pi hand-off' },
  { id: 'pi-history', prefix: 'pi-history-key', title: 'Pi history' },
  { id: 'worktrees', prefix: 'wt-key', title: 'Worktrees' },
  { id: 'draft-prs', prefix: 'pr-key', title: 'Draft PRs' },
  { id: 'gates', prefix: 'gates-key', title: 'Gates' },
]
const refused = 'Clear the prompt first: ctrl+x b focuses the pane only from an empty prompt.'
const cases = [
  { name: 'empty prompt', text: '', result: 'focused' },
  { name: 'whitespace prompt', text: ' \t\n ', result: 'focused' },
  { name: 'nonempty prompt', text: 'abc', result: 'blocked' },
  { name: 'engine refuses focus', text: '', result: 'unfocused' },
  { name: 'engine does not list the pane', text: '', result: 'missing' },
]

for (const { id, prefix, title } of panes) {
  for (const scenario of cases) {
    test(`${id} focus action: ${scenario.name}`, async ($, on) => {
      const clock = mock.clock(on, { now: 1_000_000 })
      const calls: unknown[] = []
      on('prompt.read', () => {
        calls.push('prompt.read')
        return { value: { text: scenario.text, cursor: scenario.text.length } } as never
      })
      on('ui.open', (_$, e) => {
        calls.push({ open: { id: e.id, title: e.title, focus: e.focus } })
        return { value: { isPlaced: true } } as never
      })
      on('ui.panes', () => {
        calls.push('ui.panes')
        return { value: [
          { id: 'another-pane', title: 'Another pane', isShown: false, isFocused: true, isPlaced: true },
          ...(scenario.result === 'missing' ? [] : [{ id, title, isShown: true, isFocused: scenario.result === 'focused', isPlaced: true }]),
        ] } as never
      })
      on('ui.toast', (_$, e) => { calls.push({ toast: e.text }); return { value: undefined } as never })
      on('ui.close', (_$, e) => { calls.push({ close: e.id }); return { value: undefined } as never })
      const ui = await $.ui.mount({
        plugin: 'session-band', component: 'Pane', surface: 'terminal', requestId: id,
        props: { title, isFocused: false, bodyColumns: 160, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
      })
      const button = await ui.find({ key: `${prefix}-focus` })
      expect(button?.props.action).toBe('app:cycleDiffBase')
      expect(button?.props.label).toBe('ctrl+x b')
      expect(button?.props.plain).toBe(true)
      expect(button?.props.dimColor).toBe(true)
      await ui.press({ key: `${prefix}-focus` })
      await clock.settle()
      expect(calls).toEqual(scenario.result === 'blocked'
        ? ['prompt.read', { toast: refused }]
        : [
          'prompt.read', { open: { id, title, focus: true } }, 'ui.panes',
          ...(scenario.result === 'focused' ? [] : [{ toast: refused }]),
        ])
    })
  }
}
