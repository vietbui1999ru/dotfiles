---
name: verify-spec
description: Verify implemented code against a spec's acceptance criteria. Runs the spec's verify commands first (ac-run check), then a diff scan for gamed tests and suppressions (floor-guard), with a bounded fix loop of at most 3 reruns, then archives SPEC.md under docs/specs as the branch's last commit. Reads code only for manual ACs. Invoke after implementation, before PR.
allowed-tools: "Bash,Read,Write,Edit,Agent"
---

# Verify Spec — Acceptance Criteria Verification

## When to invoke

Invoke after implementation is complete, before opening a PR:
- After a TDD (superpowers:test-driven-development) slice completes
- After any AI-assisted feature implementation
- When you want a structured pass/fail report against a spec

Status comes from exit codes, not from reading code. Reading is only for ACs marked `verify: manual`.

## Step 0: Resolve the spec

Try in order:

**0a. SPEC.md at the repo root**, used only when its frontmatter `branch:` equals the output of `git branch --show-current`. A SPEC.md for another branch is stale; skip it.

**0b. Branch → GitHub issue**
```bash
BRANCH=$(git branch --show-current)
ISSUE=$(echo "$BRANCH" | grep -oE '[0-9]+' | tail -1)
[ -n "$ISSUE" ] && gh issue view "$ISSUE" 2>/dev/null
```

**0c. Local PRD file**
```bash
ls docs/superpowers/specs/*.md 2>/dev/null | head -5
```

**0d. User fallback**
If none resolves: ask "Where is the spec? (issue number / file path / paste it)"

Steps 1 and 2 need SPEC.md (0a). For an issue or PRD spec, extract the acceptance criteria (lists under "Acceptance Criteria", "Done when", checkboxes, Given/When/Then), confirm the count with the user, and treat each as MANUAL in Step 3.

## Step 1: Run the acceptance criteria (primary)

```bash
~/dotfiles/scripts/ac-run check SPEC.md
```

It runs every `verify:` command and prints a table `| AC | Result | Exit | Seconds |`. Results: PASS, FAIL, TIMEOUT, PRE-SATISFIED (the AC was already true before the change), MANUAL. Exit 0 means all PASS or MANUAL; 1 means a FAIL, TIMEOUT or PRE-SATISFIED; 2 is a usage, parse or branch error; 3 means the spec has no approval record and nothing ran. On exit 3, stop and tell the user the spec needs their approval; never approve it yourself.

## Step 2: Scan the diff

```bash
~/dotfiles/scripts/floor-guard
```

It flags added suppressions, added test skips, deleted test files, removed assertions, and added stubs or swallowed errors (`path:line: [rule] text`). Findings are advisory: report every one as is. Never reword code to dodge a pattern; the human decides at review.

## Step 3: Read-pass for MANUAL ACs only

For each AC that Step 1 lists as MANUAL (or every AC of an issue or PRD spec), read the relevant code and judge it: PASS, FAIL or UNVERIFIABLE, citing file and line for anything not PASS. If your harness has subagents, you may delegate this read-pass to one; nothing requires it. Never use this pass to overrule a FAIL from Step 1.

## Fix loop

If Step 1 reports FAIL, TIMEOUT or PRE-SATISFIED: find the root cause in the code, fix it, and rerun Steps 1 and 2. Fix and rerun at most 3 times, then stop and report the outputs.

- Never edit a `verify:` line or a `baseline:` line. Editing either voids approval. If a verify command itself is wrong, report it and ask the user to fix and re-approve the spec.
- Never edit an existing test to make a check pass, and never weaken an assertion. The one allowed edit: replace the `raise NotImplementedError` (or `expect(true).toBe(false)`) placeholder body of a stub you wrote for this spec with the real assertions.
- Write test stubs only for ACs whose verify target does not exist yet (for example, the named test file or test function is missing). Ask before writing them. A stub must fail until implemented:

```
# Python (pytest)
def test_<ac_slug>():
    """AC-N: <AC text>"""
    raise NotImplementedError

# TypeScript (vitest/jest)
it('AC-N: <AC text>', () => {
  expect(true).toBe(false) // force red
})
```

## Step 4: Report

Paste the full output of `ac-run check` and `floor-guard`, then:
```
Spec: <source>
ac-run check exit: <code>    floor-guard exit: <code>
MANUAL ACs: <id: PASS | FAIL | UNVERIFIABLE, evidence>
Fix attempts used: <n> of 3
Test stubs written: <n files>
```

## Step 5: Archive the spec

Only when the spec came from 0a, Step 1 exited 0, and the work is ready for the PR to be marked ready or merged (spec-loop rule 7). Both scripts expect `SPEC.md` at the root, so this runs after them, as the branch's last commit:

```bash
BRANCH=$(git branch --show-current)
DATE=$(git log --diff-filter=A --format=%as -- SPEC.md | tail -1)
SLUG=${BRANCH#*/}
mkdir -p docs/specs
git mv SPEC.md "docs/specs/${DATE}-${SLUG}.md"
git commit -m "docs(specs): archive the ${SLUG} spec under docs/specs"
```

Commit only the rename. Approval records live outside the repo and are unaffected. If more changes are needed after archiving, `git mv` the file back to `SPEC.md` first, so Steps 1 and 2 can find it.

## Rationalizations

| Excuse | Reality |
|---|---|
| "The code clearly does it." | Reading is not running. Status comes from the exit code. |
| "The verify command is wrong, I'll fix it." | Editing it voids approval. Report it and ask. |
| "It passed before I started, so it's fine." | That is PRE-SATISFIED: the AC proved nothing about this change, unless marked `baseline: pass`. |
| "That floor-guard finding is a false positive." | Report it; the human decides at review. Rewording to dodge it is gaming. |
| "One more try will fix it." | The bound is 3. Report the output. |
