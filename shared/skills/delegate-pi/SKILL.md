---
name: delegate-pi
description: Delegate a task or review to pi-coding-agent subprocess. Use for cross-vendor adversarial review, parallel open-model coding delegation, or quick council checks. Trigger when user says "delegate to pi", "pi review this", "council via pi", or when applied-ai.md rules call for a quick council check before irreversible decisions.
allowed-tools: "Bash"
---

# Delegate Pi

Routes work to the `pi` CLI as a subprocess. Three modes: **council** (adversarial review), **delegate** (async coding task via pueue), **subagent** (synchronous bounded task).

---

## Mode Selection

| Mode | When | Command pattern |
|---|---|---|
| **council** | Architectural decisions, security changes, irreversible ops | Sync `pi -p` — short prompt, one cross-vendor voice |
| **delegate** | Long coding task, parallel with current work | Async via `pueue` — fire and continue, wait later |
| **subagent** | Bounded research or transformation, result needed now | Sync `pi -p` — structured output format |

---

## Council Mode (diff gate via bin/council)

Use before committing to architectural decisions, security-relevant changes, or irreversible operations.

Council mode is a thin wrapper over the unified `bin/council` engine. It evaluates a working diff — not a task packet — and is bus-less. The engine handles 3-dimension dispatch, parallelism, vote parsing, majority rule, and fail-safe. `delegate-pi` supplies only the cross-vendor evaluator (pi/Codex) through the `COUNCIL_EVALUATOR_CMD` seam.

```bash
# Evaluate the current working diff against HEAD
COUNCIL_EVALUATOR_CMD="$HOME/.claude/skills/delegate-pi/pi-evaluator.sh" \
  "${COUNCIL_CMD:-council}" --diff HEAD

# Evaluate a range (e.g. feature branch vs main)
COUNCIL_EVALUATOR_CMD="$HOME/.claude/skills/delegate-pi/pi-evaluator.sh" \
  "${COUNCIL_CMD:-council}" --diff main...HEAD

# Stdin form — pipe a unified diff directly
git diff main...HEAD | \
  COUNCIL_EVALUATOR_CMD="$HOME/.claude/skills/delegate-pi/pi-evaluator.sh" \
  "${COUNCIL_CMD:-council}" --diff -
```

**Output** is a single JSON object on stdout:

```json
{"mode":"diff","verdict":"PASS|FAIL","votes":[
  {"dimension":"acceptance-criteria","vote":"PASS|FAIL|ABSTAIN","reason":"..."},
  {"dimension":"code-quality",       "vote":"PASS|FAIL|ABSTAIN","reason":"..."},
  {"dimension":"style",              "vote":"PASS|FAIL|ABSTAIN","reason":"..."}
]}
```

Read `.verdict` for the gate decision. Read `.votes[].reason` for per-dimension rationale.

**Dimensions and voting:** Three dimensions — `acceptance-criteria`, `code-quality`, `style` — each gets one `pi` call through `pi-router.sh`. Majority rule: verdict is PASS if ≥ 2 dimensions vote PASS; all-ABSTAIN and ties fail-safe to FAIL. Routing is configured in `~/.pi/agent/routing.env`; blank values fall back to Pi's own `~/.pi/agent/settings.json` defaults.

**Why a cross-vendor evaluator matters:** Different training lineages surface different blind spots. A Codex evaluator will catch issues that Claude-family reviewers normalize away, and vice versa. The engine's majority rule makes that disagreement structurally load-bearing — a single dissenting dimension cannot override two passing ones, but two dissenting dimensions will fail the gate.

---

## Delegate Mode (async via pueue)

For long tasks that run in the background while you continue work.

```bash
# Fire task to pueue (medium difficulty)
TASK_ID=$(pueue add -i --print-task-id -- \
  "pi --model opencode-go/deepseek-v4-pro:high \
      -p '<full task description>' < /dev/null")

# Check when ready
pueue wait "$TASK_ID" && pueue log "$TASK_ID"
```

**Model routing for delegation:**

| Task difficulty | Model |
|---|---|
| high | `PI_DELEGATE_HIGH_MODEL` from `~/.pi/agent/routing.env` |
| medium | `PI_DELEGATE_MEDIUM_MODEL` from `~/.pi/agent/routing.env` |
| low | `PI_DELEGATE_LOW_MODEL` from `~/.pi/agent/routing.env` |

Default routes: high=`openai-codex/gpt-5.5:high`, medium=`opencode-go/deepseek-v4-pro:high`, low=`opencode-go/deepseek-v4-flash:off`. Note: `--fallback-models` requires a custom extension (not built-in). Without it, assign model per task at dispatch time.

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

### Dispatch + collect

```bash
# 1. Dispatch all tasks, collect IDs
T_REVIEW=$(pueue add -i --print-task-id -- \
  "pi --model openai-codex/gpt-5.5:high \
      -p '<review task>' < /dev/null")

T_IMPL=$(pueue add -i --print-task-id -- \
  "pi --model opencode-go/deepseek-v4-pro:high \
      -p '<implementation task>' < /dev/null")

T_LOW=$(pueue add -i --print-task-id -- \
  "pi --model opencode-go/deepseek-v4-flash:off \
      -p '<low-difficulty task>' < /dev/null")

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
)" --model opencode-go/deepseek-v4-flash:off --no-session --no-extensions --no-skills
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
