# Work Order — pane handoff: Claude plans, Pi implements in a live pane

**For:** Pi (implementer). **Repo:** `~/dotfiles`. **Written:** 2026-09-22.
**Status:** ready to build, not started.

Today an approved plan reaches Pi through `pueue`: fire-and-forget, output read later with
`pueue log`. This work order adds the second dispatch shape — Pi running interactively in a pane
beside the planner, in the target repo, started with a model the human picked at handoff time.

**Before you start:** `agent-review` is live in this repo. Every run of yours that changes a file
produces a pending review and blocks your next input until it is resolved. Review with
`:AgentReview` in Neovim, or run `python3 scripts/agent-review mode off` for the duration and
`mode on` when done. The CLI is not on `PATH`; call it by path.

---

## Established facts — verified, do not re-derive

`herdr` (`/opt/homebrew/bin/herdr`) is a terminal workspace manager for AI coding agents and
already has every primitive this needs. Confirmed from its own `--help` output:

- `herdr pane split [PANE_ID] [--pane <ID>|--current] --direction <right|down> --cwd <PATH>`
- `herdr agent start <NAME> --kind <KIND> --pane <ID> [--timeout <MS>] [-- <AGENT_ARG>...]`
  `--kind` accepts `pi` (and `claude`, `codex`, 20 others). It waits for interactive readiness and
  succeeds only when the expected agent is detected in that terminal. Default timeout 30000 ms,
  max 300000.
- `herdr agent prompt <TARGET> <TEXT> --wait` — submit a prompt and block until it settles
- `herdr agent wait|read|list|get|focus|send-keys|rename|attach` — drive and inspect afterwards

Pi's model surface: `--model <provider/id[:thinking]>` and `--thinking <off|minimal|low|medium|
high|xhigh|max>`. Provider, model and effort collapse into one argument, e.g.
`--model opencode-go/deepseek-v4-pro:high`. `--models` is Ctrl+P cycling only — **not** automatic
failover.

Tier vocabulary already exists in `~/.pi/agent/routing.env`: `PI_DELEGATE_HIGH_MODEL`,
`PI_DELEGATE_MEDIUM_MODEL`, `PI_DELEGATE_LOW_MODEL`. All three routes were verified answering on
2026-09-22.

---

## Out of scope — automatic cross-provider fallback

Do not build it here, and do not work around its absence.

The `provider-governance` extension is enabled (symlinked into `~/.pi/agent/extensions/`) and its
live config at `~/.pi/agent/provider-governance.json` sets
`"allowAutomaticCrossProviderFallback": false`; `/provider-policy` reports it as PROHIBITED. The
extension is observation-only by design, so the flag grants permission rather than implementing
behavior.

There is also a structural reason to keep it separate: an interactive pane cannot be re-execed
without losing the session, so fallback for this dispatch shape has to live inside Pi as an
extension hooking the error event — not in the wrapper this work order builds. The extension
already classifies provider health at `src/observation.ts:134` (`429`/`5xx` → degraded,
`401/403/404/410` → unavailable), which is the correct trigger boundary when that work happens.

What this work order does instead: make the chosen model an explicit parameter, and leave a
documented seam where a future fallback would attach.

---

## Part 1 — the dispatch script

**Create:** `scripts/pane-handoff`

An executable script (bash, `set -euo pipefail`), matching the style of `scripts/agent-review`.

```
usage: pane-handoff --spec <path> --repo <path> --model <provider/id[:thinking]>
                    [--name <agent-name>] [--direction right|down] [--no-prompt]
```

Behavior, in order:

1. Validate: spec file exists and is non-empty; repo path is a directory and a git work tree;
   `herdr` is on `PATH`. Fail with a specific message naming the offending argument — these
   messages are an agent's recovery instructions, so each states what was wrong and what correct
   input looks like.
2. Split a pane with `herdr pane split --current --direction "$DIRECTION" --cwd "$REPO"` and
   capture the new pane id from its output. If the output shape is not a bare id, parse it
   explicitly rather than assuming.
3. Start Pi in that pane: `herdr agent start "$NAME" --kind pi --pane "$PANE" -- --model "$MODEL"`.
   Default `--name` to the spec's basename without extension.
4. Unless `--no-prompt`, submit the spec: `herdr agent prompt "$NAME" "$(cat "$SPEC")" --wait`.
5. Print, on stdout, one line the caller can parse: the agent name, the pane id and the model.

Keep it under ~120 lines. It is a wrapper over `herdr`, not a framework.

## Part 2 — the fallback seam

In the same script, read the model from an overridable variable rather than hard-coding the
argument path:

```sh
MODEL="${PANE_HANDOFF_MODEL:-$model_from_flag}"
```

Add a comment block above it, three lines at most, recording that automatic cross-provider
fallback is prohibited by `provider-governance`, that it belongs inside Pi rather than here, and
that this variable is where a future resolver would hook in. Do not add retry logic, a provider
list, or a tier lookup. The seam is the whole deliverable.

## Part 3 — teach `delegate-pi` the third mode

**Edit:** `shared/skills/delegate-pi/SKILL.md`

The skill documents three modes (council, delegate, subagent) in a table near the top. Add a
fourth row, **pane**, and a section describing it, in the same terse register as the existing
sections:

- **When:** the human wants to watch and steer the implementation, or the task benefits from
  mid-run correction. Queued `delegate` mode stays the default for unattended work.
- **How:** `scripts/pane-handoff` with the flags from Part 1.
- **Model choice is the human's.** Claude asks for provider, model and effort at handoff time and
  passes the result through; no silent default, per `claude/.claude/rules/model-routing.md`.
- **Review still gates the diff.** The pane does not bypass `agent-review`.

Do not restructure the existing sections.

## Part 4 — point the handoff rule at it

**Edit:** `claude/.claude/rules/plan-handoff.md`

That rule currently names delegate mode and parallel delegate mode. Add one sentence: interactive
work that the human intends to watch goes through pane mode via `scripts/pane-handoff`, and the
model is asked for rather than assumed. Keep the file's existing length and tone — it is a rule
file, not a manual.

---

## Verification

Run from `~/dotfiles`.

| What | Command | Expected |
|---|---|---|
| Syntax | `bash -n scripts/pane-handoff` | exit 0 |
| Executable | `test -x scripts/pane-handoff` | exit 0 |
| Bad spec path | `scripts/pane-handoff --spec /nope --repo ~/dotfiles --model x/y` | non-zero, message names the spec flag |
| Not a git tree | `--repo /tmp` | non-zero, message names the repo flag |
| Dry start | with `--no-prompt` against a scratch spec and `~/dotfiles` | pane opens at that cwd, `herdr agent list` shows the agent, script prints name/pane/model |
| Cleanup after the dry run | `herdr agent list` | close the pane you opened; leave no stray agents |

Note: this shell's rtk wrapper discards exit codes at the top level. Wrap a status check as
`sh -c '<cmd> >/dev/null 2>&1; echo $?'` or a failing command will look like it passed.

Do not add tests for `herdr` itself. It is a third-party binary; the contract under test is the
script's argument handling and its error messages.

## Commit

One commit. Mention that pane mode complements queued delegation rather than replacing it, and
that cross-provider fallback is deliberately excluded with the reason.
