# Plan Handoff

After plan approval, dispatch to Pi by default — do not implement directly. Direct implementation is an exception; state why.

Use `shared/skills/delegate-pi/SKILL.md`. Use delegate mode (async through `pueue`) for one task; use parallel delegate mode for independent tasks. Interactive work the human intends to watch goes through pane mode via `scripts/pane-handoff`, with the model asked for rather than assumed. Do not build new dispatch machinery.

Dispatch approved file-backed plans through `pueue`, one task per plan:

```bash
SLUG="<plan-name>-$(openssl rand -hex 4)"
TASK_ID=$(pueue add -i --print-task-id --label "$SLUG" -- \
  "pi --model <explicit-model> --session-id pueue-$SLUG -p \"\$(cat <absolute-path-to-plan>.md)\" < /dev/null")
```

`< /dev/null` is required. Set an explicit model tier per `model-routing.md`; never rely on defaults. `--label` (a pueue flag, before `--`) and `--session-id pueue-<slug>` (a pi flag) are required: the session-band mod finds the task's Pi session by that id. `<slug>` is the plan name in lowercase `[a-z0-9-]` plus a fresh 8-hex suffix, new for every dispatch. `pi --session-id` resumes an existing session with that id, so a reused slug silently continues an old conversation.

The `\"\$(cat)\"` escaping matters: unescaped, the plan text is pasted into the stored command when the task is added.

Keep these tasks in Claude:

- Debugging and root-cause work: each next step depends on the previous result, so async delegation loses the hypothesis chain.
- The review gate: `agent-review`, `post-run-verifier`, and `pi-lens`. Pi must not edit the gate that reviews Pi.

Never run `agent-review approve`: approving a Pi run is the person's decision, made with the confirmation dialog, not an agent's.

Pi handles everything else by default, including multi-file features, migrations, and refactors.

After dispatch, report the pueue task ID. Pi commits as it works; on collection, review its commits and revert what you reject. In `~/dotfiles`, use `:AgentReview` for the live review gate.
