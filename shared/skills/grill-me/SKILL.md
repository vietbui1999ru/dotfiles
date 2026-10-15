---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree, then write a lint-clean SPEC.md at the repo root and stop for human approval. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

**Relaxed mode.** When a written spec already exists (issue body, PRD, a project instructions section, a detailed message) and you would otherwise start grilling, first print one line: `Spec detected — say 'just do it' to skip questions and self-generate.` If the user opts out ("just do it", "no questions", "skip the grill"), ask at most one question, and only for a true blocker that cannot be inferred from the spec or the codebase; if there is none, proceed silently, resolve everything else yourself, then write SPEC.md and follow the STOP section below.

## Final step: write SPEC.md

When the interview is done, write `SPEC.md` at the repo root in the format below, with `branch:` set to the output of `git branch --show-current` and `status: draft`. Every acceptance criterion (AC) gets exactly one `verify:` line: a shell command in backticks whose exit code is the verdict, or `manual - <reason>` when only a human can judge it. List every unresolved question under Open Questions with your default answer.

Write verify commands that do not depend on the caller's environment: use `uv run pytest` rather than a bare `pytest` from an activated virtualenv, and absolute tool paths where a tool is not on the default `PATH`. Each verify command must start and stop whatever it needs (a server, a fixture): `ac-run` kills the command's whole process group when it finishes, so nothing one AC leaves running is available to the next.

```markdown
---
status: draft
branch: feat/export-rate-limit
---
# SPEC: Rate-limit the export endpoint

## Objective
Stop one client from exhausting export workers. Success: >10 req/min from one key gets 429.

## Acceptance Criteria
- AC-1: 11th request in a minute from one key returns 429
  verify: `pytest -q tests/test_export_limit.py::test_eleventh_request_429`
- AC-2: Other keys are unaffected
  verify: `pytest -q tests/test_export_limit.py::test_other_keys_ok`
- AC-3: Existing export tests still pass
  verify: `pytest -q tests/test_export.py`
  baseline: pass
- AC-4: Limit is documented in the API docs
  verify: `rg -q "429" docs/api/export.md`
- AC-5: Error message reads well to a human
  verify: manual - wording judgement

## Boundaries
### Always
- Run `~/dotfiles/scripts/ac-run check SPEC.md` before claiming done
### Ask first
- New dependencies; schema changes
### Never
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- Limit per key or per IP? Default: per key.
```

Mark an AC `baseline: pass` only when it is meant to be true both before and after the change (for example, existing tests still pass).

## STOP

Run `~/dotfiles/scripts/ac-run lint SPEC.md` until it exits 0.
Print the AC list and the last line of the lint output.
Stop and wait for the user.

Do not plan or write code until the user tells you the spec is approved. Only the human approves the spec.

In an unattended or pueue run, end with a lint-clean SPEC.md at `status: draft` and stop; implementation is a separate dispatch after the human approves.

## Rationalizations

| Excuse | Reality |
|---|---|
| "The ACs are obvious, verify commands are overhead." | An AC without a command is a wish. `ac-run lint` rejects it. |
| "The user agreed in chat, I can start planning." | Agreement is not approval. Stop and wait. |
| "This one can only be judged by reading code." | Write `verify: manual - <reason>`. It shows as MANUAL, not PASS. |
| "It's an unattended run, I'll approve and continue." | Unattended runs end at `status: draft`. Implementation is a separate run. |
| "Open Questions make the spec look unfinished." | Hidden unknowns become wrong code. List each with your default. |
