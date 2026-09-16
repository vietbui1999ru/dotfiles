---
name: approval-workflow
description: Human approval gate before an agent commits work. Renders diff summary, blocks for y/n/diff input, writes approval token to .agents/approvals/. Invoke before git commit in any task that requires human sign-off.
allowed-tools: "Bash,Read"
---

# Approval Workflow

Human gate before an agent commits task work. Never auto-commit without running this skill first.

## Step 1 — Gather context

```bash
REPO=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Not in git repo"; exit 1; }
TASK_ID="${1:-UNKNOWN}"   # passed as argument or read from env AGENT_TASK_ID
SESSION_ID=$(basename "${CLAUDE_SESSION_ID:-unknown}")
```

## Step 2 — Build diff summary

```bash
# Files changed vs last commit
CHANGED=$(git diff --cached --name-only 2>/dev/null || git diff HEAD --name-only)
FILE_COUNT=$(echo "$CHANGED" | grep -c . 2>/dev/null || echo 0)
STAT=$(git diff --cached --stat 2>/dev/null || git diff HEAD --stat | tail -1)
```

## Step 3 — Present to human

Print clearly formatted approval request:

```
╔══════════════════════════════════════════════╗
║           AGENT COMMIT APPROVAL REQUEST       ║
╠══════════════════════════════════════════════╣
║ Agent:   <session-id>                        ║
║ Task:    <task-id>                           ║
║ Files:   <N> files changed                  ║
╠══════════════════════════════════════════════╣
║ Summary: <git diff --stat output>           ║
╚══════════════════════════════════════════════╝

Files changed:
  <list each changed file>

Approve this commit? [y = approve / n = reject / d = show full diff]:
```

## Step 4 — Handle response

**If `y` (approve):**
```bash
mkdir -p "${REPO}/.agents/approvals"
echo "{\"approved_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"approver\": \"human\", \"session\": \"${SESSION_ID}\"}" \
  > "${REPO}/.agents/approvals/${TASK_ID}.approved"
echo "✓ Approved. Agent may now commit."
```

**If `n` (reject):**
```bash
mkdir -p "${REPO}/.agents/approvals"
echo "{\"rejected_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"reason\": \"${REASON:-no reason given}\"}" \
  > "${REPO}/.agents/approvals/${TASK_ID}.rejected"
echo "✗ Rejected. Agent must not commit. Reason logged."
```
Then ask: "What should the agent do instead?" and relay that as instructions.

**If `d` (diff):**
Run `git diff --cached` (or `git diff HEAD`) and show it, then re-prompt with y/n.

## Step 5 — Post-approval commit gate

After writing the approval token, the agent's commit should verify:
```bash
[[ -f "${REPO}/.agents/approvals/${TASK_ID}.approved" ]] || { echo "No approval token — aborting commit"; exit 1; }
```

## Notes

- If `.agents/` doesn't exist in the repo, skip approval token writing — just get explicit y/n confirmation and print the result.
- The approval token is keyed by task ID so multiple agents can have independent approvals.
- Approval tokens are NOT deleted after commit — they serve as an audit trail.
