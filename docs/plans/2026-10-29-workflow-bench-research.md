# Workflow benchmark: research note for workflow 2

Input to the grill-me session that produces the benchmark SPEC.md. This note records what exists, what the
sources say, and a recommended starting config for each open question. Nothing here is decided until the
grill settles it.

## The three workflows

1. **Council.** Pi implements; `shared/skills/delegate-pi/pi-council.sh` runs the council (acceptance,
   code-quality, style voices at high tier, cross-vendor, chairman synthesis) plus a security veto.
2. **Single reviewer.** Pi implements; one reviewer replaces the council. Not built.
3. **send-it.** `claude/.claude/rules/send-it.md`: Haiku worker builds, Opus reviews the diff against the
   `verify:` lines, no questions, auto-merge. A separate baseline, not a controlled arm.

## Finding that reframes workflow 2

The council voices are already zero-context. `pi-evaluator.sh` sends each voice the diff only, through
`pi-router.sh`, with `--no-session --no-extensions --no-skills`, and asks for one `VOTE:` line and an
optional one-sentence `REASON:`. So the difference between workflows 1 and 2 is not session context.

Decided 2026-10-29: the workflow 2 variable is **one voice instead of the council**. Everything else in
the review stage stays the same, so the comparison changes one thing.

## Sources and what they support

| Source | Claim | Strength |
|---|---|---|
| Anthropic, "When to fold subagents into your main agent loop" (2026-10-22) | Keep a subagent for black-box verification and for work divided by context; splitting by problem type causes lossy handoffs. Eval method: ~10 golden tasks, run each more than once, inspect flipped tasks, change one thing at a time. | Vendor guidance, no numbers on review |
| Anthropic Scion write-up (wiki `summaries/anthropic-scion-source-control`) | Adversarial review is effective but myopic: it drives over-engineering against hypothetical concerns. | Vendor anecdote; likely the "recent study" behind the hypothesis |
| arXiv 2607.21656 (wiki `concepts/agent-test-verification`) | Cross-model review is asymmetric: Claude reviewing Codex raised pass rate 71.6% to 89.7%; Codex reviewing Claude lowered 91.4% to 82.8%; Claude self-review left it unchanged. | One benchmark, small n, no test execution |
| arXiv 2607.09902 (same wiki page) | Skipping review raises post-merge maintenance burden for agent code. | Correlational, 182 repos |
| r/ClaudeAI thread (2026-10-26) | A diff-only checker drifts into an expensive linter; feed it the ticket and acceptance criteria. Log what the checker blocks and classify it. Name the checker explicitly; auto-delegation skipped it in 2 of 2 runs. | Anecdotes; hypotheses to test, not evidence |

## Open questions and recommended starting config

1. **Reviewer input.** Both arms get the diff plus the SPEC.md acceptance criteria, never the transcript,
   plan or implementer notes. The current diff-only prompt risks the "expensive linter" failure, and
   adding ACs to both arms keeps the comparison to one variable. Changing the council's input is itself a
   change to workflow 1, so record its pre-change form as a third reference point if cheap.
2. **Model and effort.** Use one of the council's own models at the same effort. A cheaper tier is a
   later, separate experiment. Candidate: the acceptance voice's model, since it owns AC conformance.
3. **Fixed skills and instructions.** One prompt file, versioned in the repo, covering all four council
   dimensions in a single pass. No skill loading at run time (`--no-skills`), so the instruction set
   cannot vary between runs.
4. **Output contract.** Replace the one-line vote with structured findings (file, line, severity,
   failure scenario, AC id) in both arms, so findings can be counted and classified. If the council keeps
   its vote format, findings must be extracted from its `.council/` outputs instead.
5. **Loop rules.** Pi applies fixes; at most 3 review rounds (matches the verifier's repair cap); stop on
   a pass or on trivial findings only.
6. **Isolation and invocation.** A fresh `pi -p --no-session --no-extensions --no-skills` process per
   review, started by a script at a fixed step, never by model delegation.

## Metrics the SPEC needs

- Primary: counts per run of human steering messages, grill answers, review rounds, test-loop iterations
  and rejected changes, each a timestamped event in a per-run log.
- Finding quality: each reviewer finding classified as real defect, nit, stale or wrong, by the human
  with an AI second opinion blind to the workflow. This tests the over-engineering claim directly:
  count fixes that added validation or abstraction no AC asked for.
- Final code: rubric (correctness against ACs, readability, unrequested scope, defects found after
  merge), graded blind to the workflow.
- Secondary: tokens and cost per run.

## Benchmark shape

- Task set: target ~10 tasks, minimum 3-5 to start, each with a SPEC.md and `verify:` lines.
- Each task runs at least twice per workflow, since single runs hide flips.
- Same initial prompt, grill answers and steering script across workflows, where the workflow allows.
- send-it asks no questions, so its steering counts are not comparable; report its quality and defect
  numbers only.

## Still unresolved for the grill

- Which repo and which tasks form the golden set.
- Whether to keep a copy of the current diff-only council as a reference arm.
- Who grades, and how blinding is done in practice.
