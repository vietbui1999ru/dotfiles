# Plan Handoff

After plan approval, dispatch to Pi by default — do not implement directly. Direct implementation is an exception; state why.

Use `shared/skills/delegate-pi/SKILL.md`. Use delegate mode (async through `pueue`) for one task; use parallel delegate mode for independent tasks. Interactive work the human intends to watch goes through pane mode via `scripts/pane-handoff`, with the model asked for rather than assumed. Do not build new dispatch machinery.

Dispatch approved file-backed plans as:

```bash
pi --model <explicit-model> -p "$(cat <plan>.md)" < /dev/null
```

`< /dev/null` is required. Set an explicit model tier per `model-routing.md`; never rely on defaults.

Keep these tasks in Claude:

- Debugging and root-cause work: each next step depends on the previous result, so async delegation loses the hypothesis chain.
- The review gate: `agent-review`, `post-run-verifier`, and `pi-lens`. Pi must not edit the gate that reviews Pi.

Pi handles everything else by default, including multi-file features, migrations, and refactors.

After dispatch, report the pueue task ID. On collection, review Pi's diff before committing. In `~/dotfiles`, use `:AgentReview` for the live review gate.
