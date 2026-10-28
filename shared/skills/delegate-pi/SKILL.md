---
name: delegate-pi
description: Delegate a task or review to pi-coding-agent subprocess. Use for cross-vendor adversarial review, parallel open-model coding delegation, or quick council checks. Trigger when user says "delegate to pi", "pi review this", "council via pi", or when applied-ai.md rules call for a quick council check before irreversible decisions.
allowed-tools: "Bash"
---

# Delegate Pi

Routes work to the `pi` CLI as a subprocess. Four modes: **council** (adversarial review), **delegate** (async coding task via pueue), **pane** (interactive watched handoff), **subagent** (synchronous bounded task).

---

## Mode Selection

| Mode | When | Command pattern |
|---|---|---|
| **council** | Architectural decisions, security changes, irreversible ops | Sync `pi -p` — short prompt, four cross-vendor voices, one of them a security veto |
| **delegate** | Long coding task, parallel with current work | Async via `pueue` — fire and continue, wait later |
| **pane** | Watched implementation, benefits from mid-run correction | Interactive pane via `scripts/pane-handoff` |
| **subagent** | Bounded research or transformation, result needed now | Sync `pi -p` — structured output format |

---

## Council Mode (diff gate via bin/council)

Use before committing to architectural decisions, security-relevant changes, or irreversible operations.

Council mode is a thin wrapper, `pi-council.sh`, over the unified `bin/council` engine. It evaluates a working diff — not a task packet — and is bus-less. The engine handles the three-voice dispatch, parallelism, vote parsing, majority rule, and fail-safe, and `delegate-pi` supplies the cross-vendor evaluator (pi/Codex) through the `COUNCIL_EVALUATOR_CMD` seam. The wrapper adds a fourth voice, `security`, as a veto after the engine has voted.

```bash
# Evaluate the current working diff against HEAD
"$HOME/.claude/skills/delegate-pi/pi-council.sh" --diff HEAD

# Evaluate a range (e.g. feature branch vs main)
"$HOME/.claude/skills/delegate-pi/pi-council.sh" --diff main...HEAD

# Stdin form — pipe a unified diff directly
git diff main...HEAD | "$HOME/.claude/skills/delegate-pi/pi-council.sh" --diff -
```

The engine is `${COUNCIL_CMD:-council}`; override it only to point at a different checkout of `bin/council`.

**Output** is a single JSON object on stdout:

```json
{"mode":"diff","verdict":"PASS|FAIL","votes":[
  {"dimension":"acceptance-criteria","vote":"PASS|FAIL|ABSTAIN","reason":"..."},
  {"dimension":"code-quality",       "vote":"PASS|FAIL|ABSTAIN","reason":"..."},
  {"dimension":"style",              "vote":"PASS|FAIL|ABSTAIN","reason":"..."},
  {"dimension":"security",           "vote":"PASS|FAIL|ABSTAIN","reason":"..."}
]}
```

Read `.verdict` for the gate decision. Read `.votes[].reason` for per-dimension rationale.

**Dimensions and voting:** Three voices — `acceptance-criteria`, `code-quality`, `style` — each get one `pi` call through `pi-router.sh`. Majority rule: verdict is PASS if ≥ 2 dimensions vote PASS; all-ABSTAIN and ties fail-safe to FAIL. The fourth voice, `security` (security and correctness), is a veto rather than a vote: a FAIL turns the verdict to FAIL even when all three voices pass, while a PASS, or an answer that is not a clean vote, leaves the three-voice verdict as it is. Routing is configured in `~/.pi/agent/routing.env`; blank values fall back to Pi's own `~/.pi/agent/settings.json` defaults.

**Voices, models and efforts.** Keep these in step with `claude/.claude/rules/model-routing.md`:

| Voice | Route in `routing.env` | Default model and effort |
|---|---|---|
| `acceptance-criteria` | `PI_COUNCIL_ACCEPTANCE_MODEL` | `openai-codex/gpt-6.1-sol:high` |
| `code-quality` | `PI_COUNCIL_CODE_QUALITY_MODEL` | `opencode-go/deepseek-v4-pro:high` |
| `style` | `PI_COUNCIL_STYLE_MODEL` | `opencode-go/deepseek-v4-pro:high` |
| `security` (veto) | `PI_COUNCIL_SECURITY_MODEL` | `opencode-go/glm-5.3:high` |

Every voice runs at `medium` or `high` effort, never above it: the veto has to be cheap enough to run on every diff, and a council is one call per voice. The wrapper's test, `council-veto.test.sh`, stubs the engine and the security voice and makes no model calls.

**Why a cross-vendor evaluator matters:** Different training lineages surface different blind spots. A Codex evaluator will catch issues that Claude-family reviewers normalize away, and vice versa. The engine's majority rule makes that disagreement structurally load-bearing — a single dissenting dimension cannot override two passing ones, but two dissenting dimensions will fail the gate.

---

## Delegate Mode (async via pueue)

For long tasks that run in the background while you continue work.

```bash
# Fire task to pueue (medium difficulty). The slug must be new for every task.
# WORKTREE is an existing worktree, absolute path; create it before dispatching.
SLUG="<task-name>-$(openssl rand -hex 2)"
TASK_ID=$(pueue add -i --print-task-id --label "$SLUG" -w "$WORKTREE" -- \
  "$HOME/dotfiles/scripts/pi-view --tui pi --model opencode-go/deepseek-v4.1-flash:medium --session-id pueue-$SLUG \
      -p '<full task description>' < /dev/null")

# Check when ready
pueue wait "$TASK_ID" && pueue log "$TASK_ID"
```

Every pueue dispatch carries `--label <slug>` and `-w <worktree>` (pueue flags, before `--`) and `--session-id pueue-<slug>` (pi flag). Create the worktree first and point `-w` at it: agent-review snapshots only the run's working directory, so a Pi run started in the main checkout that edits a worktree it made itself leaves no review. Never ask Pi to create its own worktree. Parallel tasks that edit code each get their own worktree. `<slug>` is a task name of at most 11 characters in lowercase `[a-z0-9-]` plus a fresh 4-hex suffix, 16 characters at most in all; name the worktree's branch within the same 16. Never reuse a slug: `pi --session-id` resumes an existing session with that id. Council and subagent modes are synchronous, not pueue dispatches: keep `--no-session` there and never add `--session-id`.

Start every pueue dispatch's command with `$HOME/dotfiles/scripts/pi-view`. When the dispatch comes from a herdr pane, it opens a pane that streams the run's transcript beside Claude's own pane, and reports `working` and then `done` or `blocked` to herdr. Outside herdr it simply runs Pi. Either way it exits with Pi's exit code. The session-band mod still tracks the task, because its command keeps `pi --model` and `--session-id`. Every pane is named after its task (`pi#184 pi-panes-958d`), so panes can be told apart at a glance.

Where the pane opens follows `PI_VIEW_LAYOUT`, which defaults to `auto`. Templates: `side` splits Claude's pane to the right and stacks later agent panes down that column, `below` splits it downward and lines later panes up left to right, `tab` keeps the separate `pi` tab, and `auto` picks `side` from 160 columns wide and `below` under that. Claude keeps about 60% of the split. Up to three agent panes fit beside it; a fourth dispatch, or one that would fall under 40 columns by 8 rows, overflows into the `pi` tab, as does any failure to ask herdr.

For a run the person wants to steer, put `--live` before the Pi arguments: text typed in the viewer pane, or `$HOME/dotfiles/scripts/pi-steer <session-id> "<message>"` from the main pane, reaches Pi as a steer while it works or a new prompt once it is idle. `/abort` stops the current turn and keeps the session; `/done` ends it. After Pi settles it waits 120 s for more input before closing, so the task holds its pueue slot during that grace period.

Implementation dispatches, meaning any task that edits code, use `--tui` by default; search, exploration, viewing and review dispatches use plain `pi-view`. With `--tui` before the Pi arguments, the herdr pane runs Pi's own interactive TUI with the request already submitted, so they steer, queue follow-ups and add prompts in Pi directly, and Pi's herdr extension reports its state. The pueue task, and its slot, lasts until they quit Pi (`Ctrl+D`); `pueue kill` ends Pi in the pane. Outside herdr there is no pane, so `--tui` runs as a plain dispatch. When Pi exits normally, `scripts/pi-pane-run` writes the exit file and closes its own pane, so the slot frees up for the next queued dispatch. A `--tui` run that settles — herdr's `agent_status` reads `idle` or `done` for 15 s while the pane is unfocused — moves to the workspace's `verdict` tab and keeps running there, which frees its slot beside Claude; it moves at most once, and herdr shows `pi#<task> ready for verdict`. In the mod's Pi hand-off pane the selected `--tui` run gets `o` to focus its pane, a Close button that sends `ctrl+d` (killing the task if Pi does not quit) and a Continue that types into Pi's TUI — a steer while it works, a new prompt once it is idle — instead of dispatching again. The Monitor row says whether that pane is `beside`, in `verdict` or in the `pi` tab.

**Pi has no web access.** Its tools are files, `qmd` and `context7` (see `shared/pi-role.md`). A task whose answer needs the open web — a URL, a current event, product research, a comparison — is Claude's, not Pi's: research it first, or hand it to Claude, and never dispatch Pi to go looking.

### After a Pi run settles

Claude owns verification. When the dispatched run settles — exit 0 or not — run `verify-spec` against the branch, then send each failure back into the same interactive Pi: type it in the `--tui` pane, or use
`$HOME/dotfiles/scripts/pi-steer <session-id> "<failing check, file and line>"`. Do not open a second session for the same work: the first one holds the context. A plain `pi-view` run has no session to re-enter, so dispatch the fix against the same worktree.

**Model routing for delegation:**

| Task difficulty | Model |
|---|---|
| high | `PI_DELEGATE_HIGH_MODEL` from `~/.pi/agent/routing.env` |
| medium | `PI_DELEGATE_MEDIUM_MODEL` from `~/.pi/agent/routing.env` |
| low | `PI_DELEGATE_LOW_MODEL` from `~/.pi/agent/routing.env` |

Default routes: high=`opencode-go/claude-haiku-5-5:off` (keep Claude's thinking off in Pi: pi-lens and context-mode add unsaved messages to each request, which breaks Claude's signed thinking from the second turn with a 400 "thinking block is bound to a different conversation"), medium=`opencode-go/deepseek-v4.1-flash:medium`, low=`opencode-go/deepseek-v4.1-flash:off`. Delegated implementation is pure coding, so it uses the low tiers and low effort. The high tier (`openai-codex/gpt-6.1-sol:high`, `opencode-go/deepseek-v4-pro:high`, and `opencode-go/glm-5.3:high` for the security veto) is reserved for council voices and second or third adversarial reviews. These match the tiers in `claude/.claude/rules/model-routing.md`; change both together. Check an ID with `pi --list-models <name>` before adding it. Note: `--fallback-models` requires a custom extension (not built-in). Without it, assign model per task at dispatch time.

---

## Pane Mode (interactive via herdr)

Use when the human wants to watch and steer implementation, or the task benefits from mid-run correction. Queued delegate mode remains the default for unattended work.

```bash
scripts/pane-handoff --spec <path> --repo <path> --model <provider/id[:thinking]> \
  [--name <agent-name>] [--pane <id>] [--direction right|down] [--no-prompt]
```

Model choice is the human's: Claude asks for provider, model, and effort at handoff time and passes the result through. No silent default, per `claude/.claude/rules/model-routing.md`.

Review still gates the diff. Pane mode does not bypass `agent-review`.

---

## Parallel Delegate Mode (T1 — multiple tasks simultaneously)

Fire N tasks to pueue at once. Wall-clock = slowest single task, not sum.

### Context injection

Pi starts with empty context — tasks must be self-contained or file-anchored:

```bash
# Preferred: file-anchored (pi reads the repo directly)
pi --model ... -p "Refactor src/auth/middleware.ts — extract token validation.
File is already in the repo." < /dev/null

# For context not in files: write spec to tmp, embed in prompt
cat > /tmp/task.md << 'EOF'
Goal: [deliverable]
Constraints: [scope, API compatibility, etc.]
Output: [edit in place / write to path / stdout]
EOF
pi --model ... -p "$(cat /tmp/task.md)" < /dev/null
```

These are pi command lines; a pueue dispatch wraps them as in Delegate Mode, with `--label` and `--session-id`.

### Dispatch + collect

```bash
# 1. Dispatch all tasks, collect IDs. Each task gets its own fresh slug and its own
#    existing worktree (WT_REVIEW, WT_IMPL, WT_LOW: absolute paths, created beforehand).
S_REVIEW="review-$(openssl rand -hex 2)"
S_IMPL="impl-$(openssl rand -hex 2)"
S_LOW="low-$(openssl rand -hex 2)"

T_REVIEW=$(pueue add -i --print-task-id --label "$S_REVIEW" -w "$WT_REVIEW" -- \
  "$HOME/dotfiles/scripts/pi-view pi --model openai-codex/gpt-6.1-sol:high --session-id pueue-$S_REVIEW \
      -p '<review task>' < /dev/null")

T_IMPL=$(pueue add -i --print-task-id --label "$S_IMPL" -w "$WT_IMPL" -- \
  "$HOME/dotfiles/scripts/pi-view --tui pi --model opencode-go/deepseek-v4.1-flash:medium --session-id pueue-$S_IMPL \
      -p '<implementation task>' < /dev/null")

T_LOW=$(pueue add -i --print-task-id --label "$S_LOW" -w "$WT_LOW" -- \
  "$HOME/dotfiles/scripts/pi-view --tui pi --model opencode-go/deepseek-v4.1-flash:off --session-id pueue-$S_LOW \
      -p '<low-difficulty implementation task>' < /dev/null")

# 2. Optional: check status without blocking
pueue status

# 3. Wait for all + collect results
pueue wait "$T_REVIEW" "$T_IMPL" "$T_LOW"
echo "=== REVIEW ===" && pueue log "$T_REVIEW"
echo "=== IMPL ===" && pueue log "$T_IMPL"
echo "=== LOW ===" && pueue log "$T_LOW"
```

**Provider distribution**: fallback chains span OpenCode Go + Codex pools — rate limit on one provider automatically falls to the next. Parallel tasks hit different providers simultaneously.

---

## Subagent Mode (sync bounded task)

For tasks that need a result before continuing. Keep prompt under 2K tokens; pi context starts fresh.

```bash
# Research subagent
pi -p "$(cat <<'EOF'
Task: [specific bounded task]
Output format: [JSON / bullet list / code block]
Constraints: [length limit, scope limit]
EOF
)" --model opencode-go/deepseek-v4.1-flash:off --no-session --no-extensions --no-skills
```

**When NOT to use subagent mode:** Tasks requiring access to local files (pi starts with empty context), tasks needing tool calls beyond what pi supports by default, tasks where failure has no retry.

---

## Prerequisites

```bash
# Start pueue daemon (once per boot, or add to shell startup)
pueued -d

# Verify
pueue status
```

---

## Sandboxing

If pi lacks permission controls in the environment:

```bash
srt -c pi   # Anthropic Sandbox Runtime wraps pi
# Configure allowed paths in ~/.srt-settings.json
```

---

## Output Handling

1. For council mode: parse the engine JSON — read `.verdict` for the gate result and `.votes[].reason` for per-dimension rationale. No manual synthesis needed; the engine applies majority rule.
2. For delegate mode: `pueue log <id>` gives full stdout. Parse for deliverables (files, diffs, summaries).
3. For subagent mode: validate output format before trusting. Pi has no schema enforcement.

---

## Related Patterns

- [[concepts/council-pattern]] — full multi-stage deliberation with Chairman synthesis
- [[entities/pi-agent]] — pi-mono architecture, GitHub Models integration, pueue delegation
- [[concepts/multi-vendor-adversarial-review]] — where pi fits in the review spectrum
- [[concepts/agent-subagents]] — when to use pi delegation vs CC subagents
