# session-band /pi pueue controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Control Pi hand-offs from inside Claude Code without a terminal: `/pi kill|pause|resume|rm|hold|release <ids|all>`, an inline kill confirmation, kill/pause buttons on each Monitor row, pane keys, and a desktop notification when a tracked hand-off finishes.

**Architecture:** A new pure module `hooks/controls.ts` parses `/pi` arguments, decides which pueue tasks an action may touch, and builds pueue argv (never with an empty id list). `hooks/pane.tsx` wires it to the `/pi` command, the pane buttons, the inline confirm and the key handler; the confirm lives in the `handoff` atom. `hooks/handoff.tsx` sends the finish notification from the poller, where state transitions are already observed. Pane keys come from a small `Client` surface module, `hooks/pane-keys.tsx`, that posts each key to the hooks as `ui.message`.

**Tech Stack:** Claude Code mod engine (hooks module in TSX, `claude-code` and `claude-code/testing`), pueue v4 CLI, Bun-based `claude plugin test`.

**Spec:** this plan; the choices come from the 2026-10-14 session (all four suggested items chosen, "Kill + hold queue" as a separate action). Background: `docs/superpowers/plans/2026-10-10-session-band-pi-handoff.md` (M1-M5) and `...-m7-monitor.md`.

## Global Constraints

- Work only in `session-band-plugin/`. Never edit `scripts/agent-review`, `nvim/**/agent_review.lua`, or anything under `.pi/agent-review` (Pi must not edit the gate that reviews Pi).
- Never run `pueue kill`, `pueue pause`, `pueue start` or `pueue remove` with an empty id list: with no ids pueue acts on the whole default group (`pueue kill` with no ids kills every task in it). The one deliberate group-wide command is `pueue pause --group <g> --wait` for hold and `pueue start --group <g>` for release.
- Only act on pueue tasks whose command is a Pi dispatch (`isPiDispatch` in `hooks/pueue.ts`). Refuse other ids with a message naming them.
- `all` means the live tasks this session tracks (the `handoff` atom), never every pueue task.
- Keep the existing tests green: `cd session-band-plugin && claude plugin test .` (135 pass at `a20a6fd`). `claude plugin validate .` must pass.
- Commit after each task with a conventional message (`feat(session-band): ...`), staging files by path.
- Engine API reference: the typings file the plugin-authoring skill writes (`types/claude-code.d.ts`); once loaded, `session-band-plugin/.claude-plugin/types/claude-code/index.d.ts`. Grep it for `ClientProps`, `ClientKeyEvent`, `UiMessageArgument`, `NotifyOptions`, `CommandSpec`.

## Review Focus

1. **`/pi kill` with nothing to act on** (no ids, no selected live task, or every id finished): reply with a message and make no pueue call at all. Pinned in Task 1 (`controlArgv` throws on `[]`) and Task 2 (command test asserts zero pueue calls).
2. **An id that is not a Pi hand-off** (`/pi kill 3` where task 3 is some other pueue job): refused by id, nothing killed. Pinned in Task 2.
3. **A confirm that went stale**: the confirm row is up, the task finishes (or 60 s pass) before Kill is pressed. On press, re-read state and act only on ids still eligible; an expired confirm does nothing and says so. Pinned in Task 3.
4. **Hold leaves the queue paused**: after `hold`, the group stays paused until released; the reply must say how (`/pi release`). Pinned in Task 2.
5. **Notification repeated** after another poll, or after a module reload (a reload clears module variables): notify only on a transition seen live in the previous state and finished in the new one. Pinned in Task 5.

---

## File Structure

- Create `session-band-plugin/hooks/controls.ts`: pure parsing, eligibility and argv. No engine calls.
- Create `session-band-plugin/hooks/controls.test.ts`.
- Create `session-band-plugin/hooks/fake-pueue.ts`: the test helper (fake pueue beneath the plugin), moved out of `handoff-race.test.ts` so several test files share it.
- Modify `session-band-plugin/hooks/handoff-race.test.ts`: import the helper instead of defining it.
- Modify `session-band-plugin/hooks/pane.tsx`: `/pi` args, confirm row, row buttons, key handling.
- Create `session-band-plugin/hooks/pi-command.test.ts`, `pane-controls.test.ts`.
- Modify `session-band-plugin/hooks/register.tsx:129`: register `/pi` with `argumentHint` and `immediate: true`.
- Modify `session-band-plugin/hooks/handoff.tsx`: confirm field in `HandoffState`; finish notifications in `poll()`.
- Modify `session-band-plugin/hooks/handoff.ts`: `finishNotice()`.
- Modify `session-band-plugin/types/index.d.ts:46`: `confirm` in `HandoffState`.
- Create `session-band-plugin/hooks/notify.test.ts`.
- Create `session-band-plugin/hooks/pane-keys.tsx` (surface module) and `pane-keys.test.ts`.

---

### Task 1: Pure controls module

**Files:**
- Create: `session-band-plugin/hooks/controls.ts`
- Test: `session-band-plugin/hooks/controls.test.ts`

**Interfaces:**
- Consumes: `Task`, `PueueState`, `isPiDispatch` from `./pueue`; `TrackedTask` from `./handoff`.
- Produces:
  - `type ControlAction = 'kill' | 'pause' | 'resume' | 'rm' | 'hold' | 'release'`
  - `type PiArgs = { kind: 'open' } | { kind: 'control'; action: ControlAction; target: 'selected' | 'all' | number[] } | { kind: 'error'; text: string }`
  - `parsePiArgs(args: string): PiArgs`
  - `eligible(action: ControlAction, state: PueueState): boolean`
  - `type Targets = { ids: number[]; refused: { id: number; reason: string }[] }`
  - `resolveTargets(action: ControlAction, target: 'selected' | 'all' | number[], tracked: readonly TrackedTask[], pueue: readonly Task[], selectedId?: number): Targets`
  - `controlArgv(action: Exclude<ControlAction, 'hold' | 'release'>, ids: readonly number[]): string[]` (throws on `[]`)
  - `holdArgvs(group: string, ids: readonly number[]): string[][]` (throws on `[]`)
  - `releaseArgv(group: string): string[]`
  - `PI_USAGE: string`

- [ ] **Step 1: Write the failing tests**

```ts
// session-band-plugin/hooks/controls.test.ts
import { expect, test } from 'claude-code/testing'

import { controlArgv, eligible, holdArgvs, parsePiArgs, releaseArgv, resolveTargets } from './controls'
import type { Task } from './pueue'

const pi = (id: number, state: Task['state']): Task => ({
  id, cwd: '/work', state, command: `pi --model m:high --session-id pueue-s${id} -p x < /dev/null`,
})
const tracked = (task: Task) => ({ id: task.id, cwd: '/work', addedMs: 0, task })

test('parses /pi arguments', () => {
  expect(parsePiArgs('')).toEqual({ kind: 'open' })
  expect(parsePiArgs('  ')).toEqual({ kind: 'open' })
  expect(parsePiArgs('kill 44 #45')).toEqual({ kind: 'control', action: 'kill', target: [44, 45] })
  expect(parsePiArgs('kill')).toEqual({ kind: 'control', action: 'kill', target: 'selected' })
  expect(parsePiArgs('pause all')).toEqual({ kind: 'control', action: 'pause', target: 'all' })
  expect(parsePiArgs('resume 3')).toEqual({ kind: 'control', action: 'resume', target: [3] })
  expect(parsePiArgs('rm 41')).toEqual({ kind: 'control', action: 'rm', target: [41] })
  expect(parsePiArgs('hold 44')).toEqual({ kind: 'control', action: 'hold', target: [44] })
  expect(parsePiArgs('release')).toEqual({ kind: 'control', action: 'release', target: 'all' })
  expect(parsePiArgs('kill 4x')).toMatchObject({ kind: 'error' })
  expect(parsePiArgs('explode 4')).toMatchObject({ kind: 'error' })
})

test('each action applies only to the states it can change', () => {
  expect(['Running', 'Queued', 'Paused'].every(state => eligible('kill', state as Task['state']))).toBe(true)
  expect(eligible('kill', 'Done')).toBe(false)
  expect(eligible('pause', 'Running')).toBe(true)
  expect(eligible('pause', 'Paused')).toBe(false)
  expect(eligible('resume', 'Paused')).toBe(true)
  expect(eligible('resume', 'Running')).toBe(false)
  expect(eligible('rm', 'Failed')).toBe(true)
  expect(eligible('rm', 'Running')).toBe(false)
})

test('resolves targets and refuses non-Pi, unknown and ineligible ids', () => {
  const running = pi(44, 'Running')
  const done = pi(41, 'Done')
  const other: Task = { id: 3, cwd: '/work', state: 'Running', command: 'make build' }
  const pueue = [running, done, other]
  const result = resolveTargets('kill', [44, 41, 3, 99], [tracked(running), tracked(done)], pueue)
  expect(result.ids).toEqual([44])
  expect(result.refused.map(item => item.id)).toEqual([41, 3, 99])
  expect(resolveTargets('kill', 'all', [tracked(running), tracked(done)], pueue).ids).toEqual([44])
  expect(resolveTargets('kill', 'selected', [tracked(running)], pueue, 44).ids).toEqual([44])
  expect(resolveTargets('kill', 'selected', [], pueue).ids).toEqual([])
})

test('never builds a pueue command with no ids', () => {
  expect(controlArgv('kill', [44, 45])).toEqual(['pueue', 'kill', '44', '45'])
  expect(controlArgv('resume', [44])).toEqual(['pueue', 'start', '44'])
  expect(controlArgv('rm', [41])).toEqual(['pueue', 'remove', '41'])
  expect(() => controlArgv('kill', [])).toThrow()
  expect(holdArgvs('default', [44])).toEqual([['pueue', 'pause', '--group', 'default', '--wait'], ['pueue', 'kill', '44']])
  expect(() => holdArgvs('default', [])).toThrow()
  expect(releaseArgv('default')).toEqual(['pueue', 'start', '--group', 'default'])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd session-band-plugin && claude plugin test .`
Expected: `controls.test.ts` fails to load (`./controls` not found); the other 135 tests pass.

- [ ] **Step 3: Implement `controls.ts`**

```ts
// session-band-plugin/hooks/controls.ts
import type { TrackedTask } from './handoff'
import { isPiDispatch, type PueueState, type Task } from './pueue'

export type ControlAction = 'kill' | 'pause' | 'resume' | 'rm' | 'hold' | 'release'
export type PiArgs =
  | { kind: 'open' }
  | { kind: 'control'; action: ControlAction; target: 'selected' | 'all' | number[] }
  | { kind: 'error'; text: string }
export type Targets = { ids: number[]; refused: { id: number; reason: string }[] }

export const PI_USAGE = 'usage: /pi [kill|pause|resume|rm|hold] [ids|all], /pi release'
const ACTIONS: readonly ControlAction[] = ['kill', 'pause', 'resume', 'rm', 'hold', 'release']
const live = (state: PueueState) => state === 'Running' || state === 'Queued' || state === 'Paused'

export const parsePiArgs = (args: string): PiArgs => {
  const [verb, ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (!verb) return { kind: 'open' }
  const action = ACTIONS.find(item => item === verb)
  if (!action) return { kind: 'error', text: `unknown action "${verb}"; ${PI_USAGE}` }
  if (action === 'release') return { kind: 'control', action, target: 'all' }
  if (rest.length === 0) return { kind: 'control', action, target: 'selected' }
  if (rest.length === 1 && rest[0] === 'all') return { kind: 'control', action, target: 'all' }
  const ids = rest.map(word => /^#?\d+$/.test(word) ? Number(word.replace('#', '')) : Number.NaN)
  if (ids.some(Number.isNaN)) return { kind: 'error', text: `ids must be numbers; ${PI_USAGE}` }
  return { kind: 'control', action, target: [...new Set(ids)] }
}

export const eligible = (action: ControlAction, state: PueueState): boolean => {
  if (action === 'pause') return state === 'Running' || state === 'Queued'
  if (action === 'resume') return state === 'Paused'
  if (action === 'rm') return state === 'Done' || state === 'Failed' || state === 'Killed'
  return live(state)
}

export const resolveTargets = (
  action: ControlAction,
  target: 'selected' | 'all' | number[],
  tracked: readonly TrackedTask[],
  pueue: readonly Task[],
  selectedId?: number,
): Targets => {
  const byId = new Map(pueue.map(task => [task.id, task]))
  const wanted = target === 'all'
    ? tracked.filter(item => !item.dismissed).map(item => item.id)
    : target === 'selected' ? (selectedId === undefined ? [] : [selectedId]) : target
  const result: Targets = { ids: [], refused: [] }
  for (const id of wanted) {
    const task = byId.get(id)
    if (!task) result.refused.push({ id, reason: 'not in pueue' })
    else if (!isPiDispatch(task.command)) result.refused.push({ id, reason: 'not a Pi hand-off' })
    else if (!eligible(action, task.state)) result.refused.push({ id, reason: task.state })
    else result.ids.push(id)
  }
  // `all` reports only what it acts on: finished tasks are expected there, not refusals.
  return target === 'all' ? { ids: result.ids, refused: [] } : result
}

const nonEmpty = (ids: readonly number[]) => {
  if (ids.length === 0) throw new Error('refusing a pueue command with no ids: it would act on the whole group')
  return ids.map(String)
}

export const controlArgv = (action: Exclude<ControlAction, 'hold' | 'release'>, ids: readonly number[]): string[] =>
  ['pueue', { kill: 'kill', pause: 'pause', resume: 'start', rm: 'remove' }[action], ...nonEmpty(ids)]

export const holdArgvs = (group: string, ids: readonly number[]): string[][] =>
  [['pueue', 'pause', '--group', group, '--wait'], ['pueue', 'kill', ...nonEmpty(ids)]]

export const releaseArgv = (group: string): string[] => ['pueue', 'start', '--group', group]
```

`resolveTargets('kill', 'selected', ...)` with `selectedId` undefined returns no ids; Task 2 passes the pane's selected task id (`selectedTask(...)?.id`).

- [ ] **Step 4: Run the tests**

Run: `cd session-band-plugin && claude plugin test .`
Expected: all pass (139).

- [ ] **Step 5: Commit**

```bash
git add session-band-plugin/hooks/controls.ts session-band-plugin/hooks/controls.test.ts
git commit -m "feat(session-band): pure /pi control parsing, targets and pueue argv"
```

---

### Task 2: `/pi <action> <ids|all>` command

**Files:**
- Create: `session-band-plugin/hooks/fake-pueue.ts`
- Modify: `session-band-plugin/hooks/handoff-race.test.ts` (import the helper)
- Modify: `session-band-plugin/hooks/pueue.ts` (`Task.group`)
- Modify: `session-band-plugin/hooks/register.tsx:129`
- Modify: `session-band-plugin/hooks/pane.tsx` (`command.run` hook, `runControl`)
- Test: `session-band-plugin/hooks/pi-command.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces; `selectedTask` in `pane.tsx`.
- Produces:
  - `Task.group?: string` parsed from pueue JSON `group`.
  - `runControl($, action: ControlAction, ids: readonly number[], group: string): Promise<string>` in `pane.tsx`: runs the argv, updates the `handoff` atom for `rm`, returns the reply text. Task 3 and Task 6 call it.
  - `fakePueue(on, nowMs)` in `fake-pueue.ts`: returns `{ tasks, calls, armed, release, reached }`; `calls` records every pueue argv after the program name. Task status helpers `running(id, nowMs)`, `finished(task, result, nowMs)`.

- [ ] **Step 1: Move the fake pueue into a shared helper**

Move `running`, `fakePueue` and `dispatch` from `handoff-race.test.ts` into `fake-pueue.ts` and export them. Add a `calls: string[][]` array that records `e.argv.slice(1)` for every `pueue` call, and make non-status pueue commands succeed and change the fake state:

```ts
// in fakePueue's process.run hook, before the status branch:
if (e.argv[0] === 'pueue' && e.argv[1] !== 'status') {
  calls.push(e.argv.slice(1))
  const ids = e.argv.slice(2).filter(word => /^\d+$/.test(word))
  for (const id of ids) {
    const task = tasks[id]
    if (!task) continue
    const at = new Date(nowMs()).toISOString()
    if (e.argv[1] === 'kill') tasks[id] = { ...task, status: { Done: { enqueued_at: at, start: at, end: at, result: 'Killed' } } } as never
    if (e.argv[1] === 'pause') tasks[id] = { ...task, status: { Paused: { enqueued_at: at, start: at } } } as never
    if (e.argv[1] === 'start') tasks[id] = { ...task, status: { Running: { enqueued_at: at, start: at } } } as never
    if (e.argv[1] === 'remove') delete tasks[id]
  }
  return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
}
```

Give every fake task `group: 'default'`. Also export these, so later test files import rather than copy them:

```ts
import type { TestBody } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

type Kit = Parameters<TestBody>

export const finished = (task: ReturnType<typeof running>, result: 'Success' | 'Killed' | { Failed: number }, nowMs: number) => {
  const at = new Date(nowMs).toISOString()
  return { ...task, status: { Done: { enqueued_at: at, start: task.created_at, end: at, result } } } as unknown as ReturnType<typeof running>
}

export const PANE = {
  component: 'Pane' as const, surface: 'terminal' as const, requestId: 'pi-handoff',
  props: { title: 'Pi hand-off', isFocused: true, bodyColumns: 160, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

// The drawn text, Button labels included (moved from handoff-race.test.ts).
export const text = (node: unknown): string => { /* the existing body from handoff-race.test.ts, unchanged */ }

/** Mocked clock and env, toast/open/notify stubs, a fake pueue, and `count` tracked Pi hand-offs (#1..#count, Running). */
export const setupTracked = async ($: Kit[0], on: Kit[1], count = 1) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('ui.toast', () => ({ value: undefined } as never))
  const pueue = fakePueue(on, clock.now)
  for (let added = 0; added < count; added += 1) await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  pueue.calls.length = 0
  return { clock, pueue }
}
```

(`text`'s body is the function already in `handoff-race.test.ts`; move it verbatim.) Update `handoff-race.test.ts` to import from `./fake-pueue` and run the suite: still 139 pass. If `TestBody` is not exported from `claude-code/testing`, grep the typings for the test body's type and use that.

- [ ] **Step 2: Write the failing command tests**

```ts
// session-band-plugin/hooks/pi-command.test.ts
import { expect, test } from 'claude-code/testing'

import { setupTracked } from './fake-pueue'

const run = (args: string) => ({ command: 'pi', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })
const setup = ($: Parameters<typeof setupTracked>[0], on: Parameters<typeof setupTracked>[1]) => setupTracked($, on, 2)

test('/pi kill <ids> kills those Pi hand-offs and says so', async ($, on) => {
  const { pueue } = await setup($, on)
  const reply = await $.command.run(run('kill 1 2'))
  expect(pueue.calls).toContainEqual(['kill', '1', '2'])
  expect(reply.text).toContain('#1')
})

test('/pi kill with nothing eligible makes no pueue call', async ($, on) => {
  const { pueue } = await setup($, on)
  const reply = await $.command.run(run('kill 99'))
  expect(pueue.calls).toEqual([])
  expect(reply.text).toContain('99')
})

test('/pi kill refuses an id that is not a Pi hand-off', async ($, on) => {
  const { pueue } = await setup($, on)
  pueue.tasks['7'] = { ...pueue.tasks['1']!, id: 7, command: 'make build' }
  const reply = await $.command.run(run('kill 7'))
  expect(pueue.calls).toEqual([])
  expect(reply.text).toContain('not a Pi hand-off')
})

test('/pi hold pauses the group without its running tasks, kills the target, and says how to release', async ($, on) => {
  const { pueue } = await setup($, on)
  const reply = await $.command.run(run('hold 1'))
  expect(pueue.calls).toEqual([['pause', '--group', 'default', '--wait'], ['kill', '1']])
  expect(reply.text).toContain('/pi release')
  await $.command.run(run('release'))
  expect(pueue.calls.at(-1)).toEqual(['start', '--group', 'default'])
})

test('/pi kill all asks for confirmation in the pane instead of killing', async ($, on) => {
  const { pueue } = await setup($, on)
  const reply = await $.command.run(run('kill all'))
  expect(pueue.calls).toEqual([])
  expect(reply.text).toContain('confirm')
})

test('/pi with no arguments still opens the pane', async ($, on) => {
  await setup($, on)
  expect((await $.command.run(run(''))).text).toBe('Pi hand-off pane opened.')
})
```

`toContainEqual` must exist in the kit's matchers: grep the typings for it; if absent, use `expect(pueue.calls.some(call => call.join(' ') === 'kill 1 2')).toBe(true)`.

- [ ] **Step 3: Run to verify they fail**

Run: `cd session-band-plugin && claude plugin test .`
Expected: the new tests fail (the `pi` hook ignores `args`); the rest pass.

- [ ] **Step 4: Implement**

In `pueue.ts` `parseStatus`, add `...(typeof task.group === 'string' ? { group: task.group } : {})` and `group?: string` to `Task`.

In `register.tsx:129`:

```ts
await $.command.register({ name: 'pi', description: 'Open Pi hand-off controls, or kill/pause/resume/rm/hold Pi tasks', argumentHint: '[kill|pause|resume|rm|hold] [ids|all] | release', immediate: true })
```

In `pane.tsx`, replace the `command.run` hook and add `runControl`:

```ts
const describeRefused = (refused: Targets['refused']) =>
  refused.length ? ` Skipped ${refused.map(item => `#${item.id} (${item.reason})`).join(', ')}.` : ''

export async function runControl($: EngineInterface, action: ControlAction, ids: readonly number[], group: string): Promise<string> {
  if (action === 'release') { await $.process.run(releaseArgv(group)); return `Queue ${group} released.` }
  if (ids.length === 0) return 'Nothing to do.'
  if (action === 'hold') {
    for (const argv of holdArgvs(group, ids)) await $.process.run(argv)
    return `Held queue ${group} and killed ${ids.map(id => `#${id}`).join(' ')}. Run /pi release to start the queue again.`
  }
  await $.process.run(controlArgv(action, ids))
  if (action === 'rm') await update($, handoff, state => ({ ...state, tasks: state.tasks.filter(item => !ids.includes(item.id)) }))
  const verb = { kill: 'Killed', pause: 'Paused', resume: 'Resumed', rm: 'Removed' }[action]
  return `${verb} ${ids.map(id => `#${id}`).join(' ')}.`
}

on('command.run', { command: 'pi' }, async ($, e, _next) => {
  const parsed = parsePiArgs(e.args)
  if (parsed.kind === 'open') { await open($); return { text: 'Pi hand-off pane opened.' } }
  if (parsed.kind === 'error') return { text: parsed.text }
  const status = await $.process.run(['pueue', 'status', '--json'])
  if (status.exitCode !== 0) return { text: 'pueue daemon unavailable.' }
  const pueue = parseStatus(status.stdout)
  const state = await read($, handoff)
  const selected = selectedTask(state.tasks, state.selectedId)?.id
  const { ids, refused } = resolveTargets(parsed.action, parsed.target, state.tasks, pueue, selected)
  if (parsed.target === 'all' && parsed.action !== 'release' && ids.length > 0 && (parsed.action === 'kill' || parsed.action === 'hold')) {
    const nowMs = await $.clock.now()
    await update($, handoff, value => ({ ...value, confirm: { action: parsed.action as 'kill' | 'hold', ids, atMs: nowMs } }))
    await open($)
    return { text: `Press Kill in the Pi hand-off pane to confirm ${parsed.action} of ${ids.map(id => `#${id}`).join(' ')}.` }
  }
  const group = pueue.find(task => ids.includes(task.id))?.group ?? 'default'
  if (ids.length === 0 && parsed.action !== 'release') return { text: `Nothing to ${parsed.action}.${describeRefused(refused)}` }
  return { text: `${await runControl($, parsed.action, ids, group)}${describeRefused(refused)}` }
})
```

The `confirm` field is added to `HandoffState` in Task 3; to keep this task compiling, add it now in `handoff.tsx` (`HandoffState`) and `types/index.d.ts:46` as `confirm?: { action: 'kill' | 'hold'; ids: number[]; atMs: number }`. Delete the old `controlArgv` in `pane.tsx` and route `control()` through `runControl` (the Abort, Pause and Remove buttons keep working: `control($, task, 'kill')` becomes `runControl($, 'kill', [task.id], task.task?.group ?? 'default')`, `start` becomes `resume`, `remove` becomes `rm`). Update `pane.test.ts`'s `controlArgv` test to the new module's `controlArgv` from `./controls`.

- [ ] **Step 5: Run the tests**

Run: `cd session-band-plugin && claude plugin test . && claude plugin validate .`
Expected: all pass; validate passes.

- [ ] **Step 6: Commit**

```bash
git add session-band-plugin/hooks/fake-pueue.ts session-band-plugin/hooks/handoff-race.test.ts session-band-plugin/hooks/pueue.ts session-band-plugin/hooks/register.tsx session-band-plugin/hooks/pane.tsx session-band-plugin/hooks/pane.test.ts session-band-plugin/hooks/handoff.tsx session-band-plugin/types/index.d.ts session-band-plugin/hooks/pi-command.test.ts
git commit -m "feat(session-band): /pi kill|pause|resume|rm|hold|release <ids|all>"
```

---

### Task 3: Inline kill confirm, plus Hold

**Files:**
- Modify: `session-band-plugin/hooks/pane.tsx` (render and Abort button)
- Test: `session-band-plugin/hooks/pane-controls.test.ts`

**Interfaces:**
- Consumes: `runControl`, `resolveTargets`, `HandoffState.confirm`, `fakePueue`.
- Produces: `askConfirm($, action: 'kill' | 'hold', ids: number[])` in `pane.tsx` (sets `confirm` with `atMs`); `CONFIRM_MS = 60_000`. Task 4 and Task 6 call `askConfirm`.

- [ ] **Step 1: Write the failing tests**

```ts
// session-band-plugin/hooks/pane-controls.test.ts
import { expect, test } from 'claude-code/testing'

import { dispatch, finished, PANE, setupTracked as setup, text } from './fake-pueue'

test('Abort shows an inline confirm; Kill kills, Cancel does not', async ($, on) => {
  const { pueue } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  const drawn = text(await $.ui.render(PANE))
  expect(drawn).toContain('Kill #1')
  expect(pueue.calls).toEqual([])
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-cancel' })
  expect(text(await $.ui.render(PANE))).not.toContain('Kill #1?')
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-ok' })
  expect(pueue.calls).toContainEqual(['kill', '1'])
})

test('a confirm whose task finished meanwhile kills nothing', async ($, on) => {
  const { clock, pueue } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  pueue.tasks['1'] = finished(pueue.tasks['1']!, 'Success', clock.now())
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-ok' })
  expect(pueue.calls.filter(call => call[0] === 'kill')).toEqual([])
})

test('a confirm older than a minute expires', async ($, on) => {
  const { clock, pueue } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  await clock.advance(61_000)
  expect(text(await $.ui.render(PANE))).not.toContain('Kill #1?')
  expect(pueue.calls.filter(call => call[0] === 'kill')).toEqual([])
})

test('Hold asks to confirm, then pauses the queue and kills the task', async ($, on) => {
  const { pueue } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-hold' })
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-ok' })
  expect(pueue.calls).toEqual([['pause', '--group', 'default', '--wait'], ['kill', '1']])
})
```

`setup` gives one tracked running hand-off, #1. The kit's `ui.press` signature: grep the typings for `press: (` under the testing module; it takes `{ plugin, key }` and resolves after the handler settles.

- [ ] **Step 2: Run to verify they fail**

Expected: fail (`pi-confirm-ok` key not found / kill called directly).

- [ ] **Step 3: Implement**

In `pane.tsx`:
- Delete the module variable `aborting`.
- Add:

```ts
export const CONFIRM_MS = 60_000
export async function askConfirm($: EngineInterface, action: 'kill' | 'hold', ids: number[]) {
  const atMs = await $.clock.now()
  await update($, handoff, state => ({ ...state, confirm: { action, ids, atMs } }))
}
async function confirmNow($: EngineInterface) {
  const state = await read($, handoff)
  const confirm = state.confirm
  await update($, handoff, value => ({ ...value, confirm: undefined }))
  if (!confirm || (await $.clock.now()) - confirm.atMs > CONFIRM_MS) { await $.ui.toast('Confirmation expired; press again.'); return }
  const status = await $.process.run(['pueue', 'status', '--json'])
  const pueue = parseStatus(status.stdout)
  const { ids } = resolveTargets(confirm.action, confirm.ids, state.tasks, pueue)
  if (ids.length === 0) { await $.ui.toast('Nothing left to kill: those hand-offs already finished.'); return }
  const group = pueue.find(task => ids.includes(task.id))?.group ?? 'default'
  await $.ui.toast(await runControl($, confirm.action, ids, group))
}
```

- In the render, read `nowMs` (already read) and show the confirm row first when `state.confirm && nowMs - state.confirm.atMs <= CONFIRM_MS`:

```tsx
{confirm && <Box flexDirection="row">
  <Text color={PALETTE.red}>{`${confirm.action === 'hold' ? 'Hold queue and kill' : 'Kill'} ${confirm.ids.map(id => `#${id}`).join(' ')}? `}</Text>
  <Button key="pi-confirm-ok" onPress={() => void confirmNow($)}>{confirm.action === 'hold' ? 'Hold + kill' : 'Kill'}</Button>
  <Button key="pi-confirm-cancel" onPress={() => void update($, handoff, value => ({ ...value, confirm: undefined }))}>Cancel</Button>
</Box>}
```

  For a single id, include its state and elapsed from the monitor row: `Kill #44 (Running 8m59s)?`.
- Abort's `onPress` becomes `() => void askConfirm($, 'kill', [task.id])`.
- Add a Hold button next to Abort for live tasks: `<Button key="pi-hold" onPress={() => void askConfirm($, 'hold', [task.id])}>Hold queue</Button>`.

- [ ] **Step 4: Run the tests** (`claude plugin test .`): all pass.

- [ ] **Step 5: Commit**

```bash
git add session-band-plugin/hooks/pane.tsx session-band-plugin/hooks/pane-controls.test.ts
git commit -m "feat(session-band): inline kill confirm and Hold queue in the /pi pane"
```

---

### Task 4: Kill and pause buttons on each Monitor row

**Files:**
- Modify: `session-band-plugin/hooks/pane.tsx` (Monitor rows)
- Test: `session-band-plugin/hooks/pane-controls.test.ts` (add tests)

**Interfaces:**
- Consumes: `askConfirm`, `runControl`, `eligible`.
- Produces: row button keys `pi-row-kill-<id>` and `pi-row-pause-<id>`.

- [ ] **Step 1: Write the failing tests** (append to `pane-controls.test.ts`)

```ts
test('each live Monitor row has its own kill and pause buttons', async ($, on) => {
  const { pueue } = await setup($, on, 2) // #1 and #2 running
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-row-pause-2' })
  expect(pueue.calls).toContainEqual(['pause', '2'])
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-row-kill-1' })
  expect(text(await $.ui.render(PANE))).toContain('Kill #1')
})

test('finished rows have no kill or pause button', async ($, on) => {
  const { clock, pueue } = await setup($, on)
  pueue.tasks['1'] = finished(pueue.tasks['1']!, { Failed: 1 }, clock.now())
  await clock.advance(2_000)
  const drawn = JSON.stringify(await $.ui.render(PANE))
  expect(drawn).not.toContain('pi-row-kill-1')
})
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

In the Monitor `rows.map`, after the row Button and before the idle text, for live rows only:

```tsx
{eligible('kill', row.state) && <Button key={`pi-row-kill-${row.id}`} plain label=" ✗" onPress={() => void askConfirm($, 'kill', [row.id])} />}
{(eligible('pause', row.state) || eligible('resume', row.state)) && <Button key={`pi-row-pause-${row.id}`} plain label={row.state === 'Paused' ? ' ▶' : ' ⏸'} onPress={() => void runControl($, row.state === 'Paused' ? 'resume' : 'pause', [row.id], 'default')} />}
```

Use the tracked task's `task?.group` instead of `'default'` (look it up in `state.tasks` by `row.id`). Reduce `columns` passed to `monitorText` by 4 for live rows so the row text still fits.

- [ ] **Step 4: Run the tests**: all pass.

- [ ] **Step 5: Commit**

```bash
git add session-band-plugin/hooks/pane.tsx session-band-plugin/hooks/pane-controls.test.ts
git commit -m "feat(session-band): per-row kill and pause buttons in the /pi Monitor"
```

---

### Task 5: Notify when a tracked hand-off finishes

**Files:**
- Modify: `session-band-plugin/hooks/handoff.ts` (`finishNotice`)
- Modify: `session-band-plugin/hooks/handoff.tsx` (`poll`)
- Test: `session-band-plugin/hooks/notify.test.ts`

**Interfaces:**
- Consumes: `PiProgress.error` (`pisession.ts`), `formatElapsed` (`handoff.ts`), `fakePueue`, `finished`.
- Produces: `finishNotice(item: TrackedTask, pi: PiProgress | undefined): string` in `handoff.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// session-band-plugin/hooks/notify.test.ts
import { expect, mock, test } from 'claude-code/testing'

import { dispatch, fakePueue, finished } from './fake-pueue'
import { finishNotice } from './handoff'

test('finish notices name the task, the result and how long it ran', () => {
  const base = { id: 44, cwd: '/w', addedMs: 0, label: 'sim3-running' }
  const task = (status: object) => ({ ...base, task: { id: 44, cwd: '/w', command: 'pi -p x', startMs: 0, endMs: 539_000, ...status } })
  expect(finishNotice(task({ state: 'Killed' }) as never, undefined)).toBe('pi#44 Killed after 8m59s · sim3-running')
  expect(finishNotice(task({ state: 'Done' }) as never, undefined)).toBe('pi#44 Done in 8m59s · sim3-running')
  expect(finishNotice(task({ state: 'Failed', exit: 1 }) as never, { error: '400: Model is unavailable.' } as never))
    .toBe('pi#44 Failed (exit 1) after 8m59s: 400: Model is unavailable. · sim3-running')
})

test('a hand-off seen running and then finished is notified once', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  const sent: string[] = []
  on('ui.notify', (_$, e) => { sent.push((e as { text: string }).text); return { value: { isSent: true, channel: 'auto' } } as never })
  const pueue = fakePueue(on, clock.now)
  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  await clock.advance(2_000)
  expect(sent).toEqual([])
  pueue.tasks['1'] = finished(pueue.tasks['1']!, 'Killed', clock.now())
  await clock.advance(2_000)
  await clock.advance(2_000)
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('pi#1 Killed')
})
```

Check the `ui.notify` event's argument shape in the typings (grep `'ui.notify'`): it may be `{ text, options }`; adjust `e.text` accordingly. The `channel` field of the result must be a valid value from `UiNotifyResult`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

In `handoff.ts`:

```ts
export const finishNotice = (item: TrackedTask, pi: PiProgress | undefined): string => {
  const task = item.task
  const ran = task?.startMs !== undefined && task.endMs !== undefined ? formatElapsed(task.endMs - task.startMs) : undefined
  const label = item.label ? ` · ${item.label}` : ''
  if (task?.state === 'Done') return `pi#${item.id} Done${ran ? ` in ${ran}` : ''}${label}`
  if (task?.state === 'Failed') return `pi#${item.id} Failed (exit ${task.exit ?? '?'})${ran ? ` after ${ran}` : ''}${pi?.error ? `: ${pi.error}` : ''}${label}`
  return `pi#${item.id} ${task?.state ?? 'Finished'}${ran ? ` after ${ran}` : ''}${label}`
}
```

In `handoff.tsx` `poll()`, read the tracked list before the merge and compare after it:

```ts
const before = new Map((await read($, handoff)).tasks.map(item => [item.id, item.task?.state]))
// ... existing snapshot, merge and update ...
const after = (await read($, handoff)).tasks
for (const item of after) {
  const was = before.get(item.id)
  if (!was || !isLive({ state: was } as Task) || isLive(item.task)) continue
  const text = finishNotice(item, next[item.id] ?? existing[item.id])
  const sent = await $.ui.notify(text, { title: 'Pi hand-off' }).catch(() => undefined)
  if (!sent?.isSent) await $.ui.toast(text)
}
```

Place the loop after the progress tail so `next` holds the final transcript (the error text). The transition test (was live, now finished) is what prevents repeats: the next poll sees it finished in `before`. A module reload keeps the atom, so it does not re-notify either.

- [ ] **Step 4: Run the tests**: all pass.

- [ ] **Step 5: Commit**

```bash
git add session-band-plugin/hooks/handoff.ts session-band-plugin/hooks/handoff.tsx session-band-plugin/hooks/notify.test.ts
git commit -m "feat(session-band): notify when a tracked Pi hand-off finishes"
```

---

### Task 6: Pane keys

**Files:**
- Create: `session-band-plugin/hooks/pane-keys.tsx` (surface module)
- Modify: `session-band-plugin/hooks/pane.tsx` (draw the `Client`; `ui.message` hook)
- Test: `session-band-plugin/hooks/pane-keys.test.ts`

**Interfaces:**
- Consumes: `askConfirm`, `runControl`, `confirmNow` (export it from Task 3), `selectedTask`, `monitorRows`.
- Produces: the `Client` element `key="pi-keys"`, `module="./pane-keys.tsx"`; posts `{ key: string }`.

Keys while the pane's key strip has focus: `↑`/`↓` move the selection through the Monitor rows; `x` asks to kill the selected task; `h` asks to hold and kill; `p` pauses or resumes it; `y` confirms and `n` cancels a showing confirm. Escape already returns focus (engine rule).

- [ ] **Step 1: Read the API.** In the typings, read `ClientProps` (`key`, `module`, `props`), the surface module type (`ClientModule`), its surface's `onKey(fn): () => void` and `post(data)`, `UiMessageArgument` (`element`, `requestId`, `data`), and the testing kit's `Client` acts (`key`, `post`) under `Mounted`/`ui`. Register `onKey` once per instance (the module function runs on each draw): keep a `WeakSet` of surfaces already subscribed.

- [ ] **Step 2: Write the failing tests**

```ts
// session-band-plugin/hooks/pane-keys.test.ts
import { expect, test } from 'claude-code/testing'

import { PANE, setupTracked as setup, text } from './fake-pueue'

test('arrow keys move the selection and x asks to kill the selected task', async ($, on) => {
  const { pueue } = await setup($, on, 2)
  await $.ui.render(PANE)
  await $.ui.message({ surface: 'terminal', component: 'Pane', requestId: 'pi-handoff', element: 'pi-keys', module: './pane-keys.tsx', data: { key: 'down' } } as never)
  await $.ui.message({ surface: 'terminal', component: 'Pane', requestId: 'pi-handoff', element: 'pi-keys', module: './pane-keys.tsx', data: { key: 'x' } } as never)
  expect(text(await $.ui.render(PANE))).toMatch(/Kill #\d/)
  await $.ui.message({ surface: 'terminal', component: 'Pane', requestId: 'pi-handoff', element: 'pi-keys', module: './pane-keys.tsx', data: { key: 'y' } } as never)
  expect(pueue.calls.some(call => call[0] === 'kill')).toBe(true)
})

test('posted data that is not a known key is ignored', async ($, on) => {
  const { pueue } = await setup($, on)
  await $.ui.message({ surface: 'terminal', component: 'Pane', requestId: 'pi-handoff', element: 'pi-keys', module: './pane-keys.tsx', data: { key: 'rm -rf' } } as never)
  await $.ui.message({ surface: 'terminal', component: 'Pane', requestId: 'pi-handoff', element: 'pi-keys', module: './pane-keys.tsx', data: 42 } as never)
  expect(pueue.calls).toEqual([])
})
```

If the kit raises `ui.message` differently (for example through the mounted `Client`'s `post`), use that and keep the assertions. Add one surface-module test with the kit's `mount` and `key` act that a pressed `x` posts `{ key: 'x' }`.

- [ ] **Step 3: Run to verify they fail.**

- [ ] **Step 4: Implement**

`pane-keys.tsx`: a surface module that draws one dim line (`keys: ↑↓ select · x kill · h hold · p pause · y/n confirm`), subscribes `onKey` once, and posts `{ key: event.key }` for `up`, `down`, `x`, `h`, `p`, `y`, `n` only.

In `pane.tsx`: draw `<Client key="pi-keys" module="./pane-keys.tsx" />` at the top of the pane when a task exists. Add:

```ts
on('ui.message', async ($, e, next) => {
  if (e.requestId !== 'pi-handoff' || e.element !== 'pi-keys') return next(e)
  const key = (e.data as { key?: unknown } | null)?.key
  if (typeof key !== 'string' || !['up', 'down', 'x', 'h', 'p', 'y', 'n'].includes(key)) return next(e)
  const [state, allProgress, nowMs] = await Promise.all([read($, handoff), read($, progress), $.clock.now()])
  const rowIds = monitorRows(state.tasks, allProgress, state.tasks.flatMap(item => item.task ? [item.task] : []), nowMs).map(row => row.id)
  const task = selectedTask(state.tasks, state.selectedId, rowIds)
  if (key === 'up' || key === 'down') {
    if (rowIds.length > 0) {
      const at = Math.max(0, rowIds.indexOf(task?.id ?? rowIds[0]!))
      const to = rowIds[(at + (key === 'down' ? 1 : rowIds.length - 1)) % rowIds.length]!
      await update($, handoff, value => ({ ...value, selectedId: to }))
    }
  } else if (key === 'y') {
    await confirmNow($)
  } else if (key === 'n') {
    await update($, handoff, value => ({ ...value, confirm: undefined }))
  } else if (task?.task) {
    const current = task.task.state
    if ((key === 'x' || key === 'h') && eligible('kill', current)) await askConfirm($, key === 'x' ? 'kill' : 'hold', [task.id])
    if (key === 'p' && (eligible('pause', current) || eligible('resume', current))) {
      await $.ui.toast(await runControl($, current === 'Paused' ? 'resume' : 'pause', [task.id], task.task.group ?? 'default'))
    }
  }
  return next(e)
})
```

Selection wraps at the ends; `x`/`h`/`p` do nothing when the selected task is not eligible. Check in the typings what a `ui.message` hook returns (`UiMessageResult`); answer with `next(e)` after handling unless the type says otherwise.

- [ ] **Step 5: Run the tests**: all pass; `claude plugin validate .` passes.

- [ ] **Step 6: Commit**

```bash
git add session-band-plugin/hooks/pane-keys.tsx session-band-plugin/hooks/pane.tsx session-band-plugin/hooks/pane-keys.test.ts
git commit -m "feat(session-band): keyboard controls in the /pi pane"
```

---

## Verification (human live gate, after Pi finishes)

| # | Do | Expect |
|---|----|--------|
| 1 | Dispatch a Pi sleep task from a session; `/pi kill <id>` | Killed; reply names it; desktop notification `pi#<id> Killed after ...` |
| 2 | `/pi kill 99` and `/pi kill <non-Pi pueue id>` | Refusal text; `pueue status` unchanged |
| 3 | Two sleeps, second queued; Monitor row `⏸` on the running one, then `▶` | Paused, then running again |
| 4 | Abort on a running task; wait 61 s; Kill | "Confirmation expired"; task still running |
| 5 | Hold queue on the running task with one queued behind it | Running killed, queued stays Queued; `/pi release` starts it |
| 6 | Focus the key strip; `↓`, `x`, `y` | Selected task killed |
| 7 | A task against a missing model | Notification includes the 400 error text |
