# ralph-structured Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `ralph-structured` skill that wraps `/ralph-loop` with PRD-style task decomposition, one-task-per-iteration enforcement, stuckness protection, and an auto-suggestion rule.

**Architecture:** Single `SKILL.md` in `~/repos/llm-wiki/claude-setup/skills/ralph-structured/`. Phase 1 generates `.claude/tasks.json` and a `.claude/ralph-protocol.md` (the full loop protocol). Phase 2 launches `/ralph-loop` with a one-line prompt referencing the protocol file — this keeps the re-injected stop-hook prompt short while the full protocol is readable. Auto-suggestion rule lives in `applied-ai.md`.

**Tech Stack:** Bash (skill steps), JSON (tasks.json), Markdown (skill + protocol files), existing `/ralph-loop` plugin (untouched).

---

### Task 1: Create skill directory and symlink

**Files:**
- Create: `~/repos/llm-wiki/claude-setup/skills/ralph-structured/SKILL.md`
- Create symlink: `~/.claude/skills/ralph-structured`

- [ ] **Step 1: Create skill directory**

```bash
mkdir -p ~/repos/llm-wiki/claude-setup/skills/ralph-structured
```

- [ ] **Step 2: Verify directory created**

```bash
ls ~/repos/llm-wiki/claude-setup/skills/ralph-structured
```
Expected: empty directory, no error.

- [ ] **Step 3: Create symlink**

```bash
ln -s ~/repos/llm-wiki/claude-setup/skills/ralph-structured ~/.claude/skills/ralph-structured
```

- [ ] **Step 4: Verify symlink**

```bash
ls -la ~/.claude/skills/ralph-structured
```
Expected: `lrwxr-xr-x ... ~/.claude/skills/ralph-structured -> ~/repos/llm-wiki/claude-setup/skills/ralph-structured`

- [ ] **Step 5: Commit directory scaffold**

```bash
cd ~/repos/llm-wiki
git add claude-setup/skills/ralph-structured/
git commit -m "feat: scaffold ralph-structured skill directory"
```

---

### Task 2: Write SKILL.md — Phase 1 (decomposition + review gate)

**Files:**
- Create: `~/repos/llm-wiki/claude-setup/skills/ralph-structured/SKILL.md`

- [ ] **Step 1: Write the skill file**

Create `~/repos/llm-wiki/claude-setup/skills/ralph-structured/SKILL.md` with this exact content:

```markdown
---
name: ralph-structured
description: Structured ralph loop — decomposes a goal into tasks.json, enforces one-task-per-iteration, stuckness protection (3 attempts), and iteration logging. Use when a task has 3+ steps, multiple files, explicit testing requirements, or sequential dependencies ("first X then Y").
allowed-tools: "Bash,Read,Write,Edit"
---

# Ralph Structured Loop

Two phases: decompose a goal into a task file, then launch `/ralph-loop` with a
task-driver protocol. The protocol enforces one-task-per-iteration — the agent picks
the first pending task each fresh context, completes it, marks it done or blocked,
and logs the outcome. The plugin is untouched; all logic lives in the protocol file.

## Phase 1 — Task Decomposition

### Step 0: Check for existing tasks

```bash
cat .claude/tasks.json 2>/dev/null
```

If `tasks.json` exists with tasks where `status` is `"pending"`: show the remaining
tasks and ask:

> "`.claude/tasks.json` has [N] pending tasks. Resume the existing loop, or start
> fresh with a new task list?"

- **Resume** → skip to Phase 2
- **Fresh** → continue with Step 1 (will overwrite tasks.json)

### Step 1: Parse the goal

The user's goal is the argument passed to this skill invocation. If no argument was
provided, ask: "What's the goal for this loop?"

### Step 2: Generate task list

Think through the goal. Decompose into tasks using these rules:

- One task = one unit of work completable in a single agent context window
- Each task needs a clear pass/fail signal: a `test_cmd` OR a specific
  `acceptance_criteria` (not both required, but at least one must be unambiguous)
- Order by dependency — blockers first
- Max 15 tasks. If scope requires more, tell the user:
  > "This scope is too large for one loop. Suggest breaking into [N] phases."
  Then list the proposed phases and ask which to tackle first. Do not generate >15 tasks.

Write `.claude/tasks.json`:

```json
[
  {
    "id": "TASK-001",
    "title": "Short imperative title (≤10 words)",
    "acceptance_criteria": "Specific, testable condition — observable without running the code",
    "test_cmd": "npm test -- --testPathPattern=feature",
    "status": "pending",
    "attempts": 0
  }
]
```

`test_cmd` is optional — omit the field (don't write `null`) if no automated test
applies. `acceptance_criteria` is always required.

### Step 3: Show for approval

Display the task list:

```
Task list for: [goal]
──────────────────────────────────────
TASK-001: [title]
  Criteria: [acceptance_criteria]
  Test:     [test_cmd or "manual verification"]

TASK-002: [title]
  ...
──────────────────────────────────────
[N] tasks. Proceed, or edit the list?
```

Wait for user approval. If the user requests edits: update `tasks.json` and re-display
the list. Only continue to Phase 2 when the user explicitly approves.

---

## Phase 2 — Launch

### Step 4: Write the protocol file

Write `.claude/ralph-protocol.md` with this exact content, substituting `{GOAL}` with
the user's original goal:

```markdown
# Ralph Structured Loop Protocol

**Goal:** {GOAL}
**Task file:** .claude/tasks.json
**Log file:** .claude/ralph-log.md

Do NOT modify this file during the loop.

## Each iteration — follow these steps exactly

1. Read `.claude/ralph-log.md` if it exists — understand what prior iterations did
   and what was left incomplete.

2. Read `.claude/tasks.json`. Find the first task where `"status": "pending"`.

3. If no pending tasks exist:
   - Print a summary: "Loop complete. [N done, M blocked]"
   - For each blocked task, print: "BLOCKED: [id] — [title] — [acceptance_criteria]"
   - Then output exactly: <promise>ALL_TASKS_DONE</promise>

4. Increment the task's `"attempts"` counter in `tasks.json` **before starting work**.
   Use the Edit tool — do not rewrite the entire file.

5. Work **only** on this task. Do not touch any other task.

6. When the work feels complete:
   - If a `test_cmd` is present: run it via Bash
     - Tests pass → set `"status": "done"` in tasks.json
     - Tests fail AND attempts < 3 → leave `"status": "pending"` (retry next iteration)
     - attempts >= 3 → set `"status": "blocked"` regardless of test result
   - If no `test_cmd`: evaluate against `acceptance_criteria`
     - Criteria met → set `"status": "done"`
     - Criteria not met AND attempts < 3 → leave `"status": "pending"`
     - attempts >= 3 → set `"status": "blocked"`

7. Append exactly one line to `.claude/ralph-log.md`:
   `[ITER N] TASK-XXX: one sentence — what happened and the outcome (done/pending/blocked)`
```

### Step 5: Handle --kanban flag (skip if not passed)

If `--kanban` was passed by the user:

```bash
REPO=$(git rev-parse --show-toplevel 2>/dev/null) || REPO="."
mkdir -p "${REPO}/.agents/inbox" "${REPO}/.agents/claimed" "${REPO}/.agents/done"

# Mirror all pending tasks to inbox
jq -r '.[] | select(.status == "pending") | "\(.id)\t\(.title)"' .claude/tasks.json | \
  while IFS=$'\t' read -r task_id title; do
    echo "# ${task_id}: ${title}" > "${REPO}/.agents/inbox/${task_id}.md"
  done
```

### Step 6: Add .gitignore entries

```bash
REPO=$(git rev-parse --show-toplevel 2>/dev/null) || REPO="."
GITIGNORE="${REPO}/.gitignore"
for entry in ".claude/tasks.json" ".claude/ralph-log.md" ".claude/ralph-protocol.md"; do
  grep -qxF "$entry" "$GITIGNORE" 2>/dev/null || echo "$entry" >> "$GITIGNORE"
done
```

### Step 7: Launch ralph-loop

Run this Bash command to start the loop:

```bash
echo "Starting structured ralph loop..."
```

Then instruct the user:

> "Task file written. Run this to start the loop:"
> ```
> /ralph-loop Read .claude/ralph-protocol.md and follow its instructions. Do not modify that file. --completion-promise "ALL_TASKS_DONE"
> ```

Do not run `/ralph-loop` yourself — the user must type it to activate the stop hook
in their current session.
```

- [ ] **Step 2: Verify file written**

```bash
wc -l ~/repos/llm-wiki/claude-setup/skills/ralph-structured/SKILL.md
```
Expected: 120+ lines, no error.

- [ ] **Step 3: Commit**

```bash
cd ~/repos/llm-wiki
git add claude-setup/skills/ralph-structured/SKILL.md
git commit -m "feat(ralph-structured): add skill — task decomposition + structured loop launch"
```

---

### Task 3: Add auto-suggestion rule to applied-ai.md

**Files:**
- Modify: `~/dotfiles/claude/.claude/rules/applied-ai.md`

- [ ] **Step 1: Append the ralph-structured section**

Add this block at the end of `~/dotfiles/claude/.claude/rules/applied-ai.md`:

```markdown

### ralph-structured (proactive suggestion)

Before starting any multi-step implementation task, check for these signals:
- 3+ distinct deliverables mentioned in the request
- "implement", "build", "create", "migrate", "refactor" at feature scope (not single-file edits)
- Task explicitly mentions testing or verification as part of the work
- Sequential dependencies described ("first X, then Y, then Z")
- Task likely spans multiple context windows (>30 min of work)

If any signal is present: suggest `/ralph-structured` **before proceeding**. Format:

> "This looks like a multi-step task. `/ralph-structured` would break it into a
> task list with one-task-per-iteration enforcement and stuckness protection (auto-skips
> tasks stuck after 3 attempts). Want to use it, or proceed directly?"

Do NOT auto-launch. Do NOT suggest it for: single-file edits, config changes, quick fixes,
wiki ingests, or anything estimated under 3 steps.
```

- [ ] **Step 2: Verify the addition**

```bash
tail -20 ~/dotfiles/claude/.claude/rules/applied-ai.md
```
Expected: the ralph-structured section visible at the end.

- [ ] **Step 3: Commit**

```bash
cd ~/dotfiles
git add claude/.claude/rules/applied-ai.md
git commit -m "feat(rules): add ralph-structured auto-suggestion rule to applied-ai.md"
```

---

### Task 4: End-to-end verification

**Files:** No new files — runtime verification only.

- [ ] **Step 1: Verify skill is accessible**

```bash
ls -la ~/.claude/skills/ralph-structured/SKILL.md
```
Expected: symlink resolves, file is readable.

- [ ] **Step 2: Verify tasks.json schema with a dry run**

In a test directory, create a mock tasks.json manually and confirm the loop protocol
references are valid:

```bash
mkdir -p /tmp/ralph-test/.claude
cat > /tmp/ralph-test/.claude/tasks.json <<'EOF'
[
  {
    "id": "TASK-001",
    "title": "Create hello.txt",
    "acceptance_criteria": "hello.txt exists with content 'hello'",
    "status": "pending",
    "attempts": 0
  }
]
EOF
jq '.[0].id' /tmp/ralph-test/.claude/tasks.json
```
Expected: `"TASK-001"` — confirms valid JSON schema.

- [ ] **Step 3: Verify protocol file template renders correctly**

Check that the protocol file content (as written in Task 2 Step 1) references the
correct file paths:

```bash
grep -n "tasks.json\|ralph-log.md\|ALL_TASKS_DONE" \
  ~/repos/llm-wiki/claude-setup/skills/ralph-structured/SKILL.md
```
Expected: all three strings appear in the protocol section.

- [ ] **Step 4: Verify applied-ai.md rule is present**

```bash
grep -n "ralph-structured" ~/dotfiles/claude/.claude/rules/applied-ai.md
```
Expected: at least 3 matches (section header + signal list + suggestion format).

- [ ] **Step 5: Verify .gitignore logic (dry run)**

```bash
# Simulate the gitignore step
GITIGNORE=/tmp/test-gitignore
touch "$GITIGNORE"
for entry in ".claude/tasks.json" ".claude/ralph-log.md" ".claude/ralph-protocol.md"; do
  grep -qxF "$entry" "$GITIGNORE" 2>/dev/null || echo "$entry" >> "$GITIGNORE"
done
cat "$GITIGNORE"
```
Expected: three lines, no duplicates.

- [ ] **Step 6: Run idempotency check on .gitignore step**

```bash
# Run same loop twice — should not duplicate entries
for entry in ".claude/tasks.json" ".claude/ralph-log.md" ".claude/ralph-protocol.md"; do
  grep -qxF "$entry" /tmp/test-gitignore 2>/dev/null || echo "$entry" >> /tmp/test-gitignore
done
wc -l /tmp/test-gitignore
```
Expected: still 3 lines (idempotent).

- [ ] **Step 7: Clean up temp files**

```bash
rm -rf /tmp/ralph-test /tmp/test-gitignore
```

- [ ] **Step 8: Final commit — update llm-wiki index and log**

```bash
cd ~/repos/llm-wiki
```

Append to `log.md`:
```
## [2026-05-22] update | ralph-structured skill + auto-suggestion rule
New skill: claude-setup/skills/ralph-structured/ — structured ralph loop with task decomposition, one-task-per-iteration, stuckness protection, iteration log, optional kanban sync.
Updated rule: applied-ai.md — auto-suggestion for multi-step tasks.
```

```bash
git add claude-setup/skills/ralph-structured/ log.md
git commit -m "feat: add ralph-structured skill and update log"
```
