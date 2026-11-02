---
status: approved
branch: feat/provenance
---
# SPEC: Model provenance for agent-written work

## Objective
Record which model, version and effort level wrote each piece of agent work (Claude Code, Pi,
Codex) across every repo, so model quality can be compared over time. Every value is captured
outside the model (hooks, wrappers, commit-funnel): zero extra model tokens and no prompt
changes. Success: every agent commit made through `commit-funnel` carries tool-written `Agent:`
trailers naming each model that wrote the committed paths, and a report shows per-model
commit counts and follow-up-fix rates over time.

Decisions from the 2026-11-02 grilling:
- Out of band only: no stamps written by models into files or frontmatter.
- Per-model attribution: a local ledger logs each write with its model; `commit-funnel` joins
  the ledger for the committed paths and writes one trailer per model.
- Fields: harness + version, provider/model, effort, role, session, timestamp, path, op.
  A value that is not observable is written as `unknown`, never guessed or asked of the model.
  No token/cost fields.
- Existing `Co-Authored-By` lines stay (GitHub co-author display) but are not authoritative;
  `Agent:` trailers are the record used for quality tracking.
- Ledger: `~/.local/state/provenance/ledger.jsonl`, outside all repos, entries older than 30
  days pruned by the writer.
- v1 quality = git-only report; review-gate and CI joins are v2.

## Ledger row (JSONL)
`{"ts","harness","harness_version","model","effort","role","session","cwd","path","op"}`
- `model` is `provider/id` (e.g. `anthropic/claude-opus-5-5`, `openai-codex/gpt-6.1-sol`).
- Claude Code: model from a per-session state file written on SessionStart and
  PostModelSwitch; effort from the hook input's `effort.level` (or `$CLAUDE_EFFORT`); role from
  `agent_type` (main session: `main`); a subagent's model resolved from its agent definition's
  `model:` frontmatter, else `unknown`.
- Pi: `pi-view` records one run-level row (`path: "*"`, `cwd` = the run's worktree) with
  provider/model and thinking level parsed from its `--model provider/id[:thinking]` argument
  and `session` = the `--session-id`.
- Codex: the existing PostToolUse hook adds model and effort (from hook input if present, else
  `~/.codex/config.toml` `model` / `model_reasoning_effort`).

## Trailer format
One trailer per model that wrote any committed path since the branch's previous commit:
`Agent: <provider/model> effort=<e> role=<r> harness=<name>/<version> session=<id> paths=<n>`
followed by the paths (directory-compressed when more than 10) in a matching
`Agent-Paths: <provider/model> <path>, <path>, ...` trailer. Query:
`git log --format='%h %ad %(trailers:key=Agent,valueonly)' --date=short`.

## Acceptance Criteria
- AC-1: The Claude Code provenance hook appends one ledger row per Write/Edit/MultiEdit with all 10 fields, `unknown` for any value missing from its input, and prints nothing to stdout (no model-visible output)
  verify: `python3 -m unittest -v scripts/tests/test_provenance_hook.py`
- AC-2: Model comes from the session state file written on SessionStart/PostModelSwitch; a subagent's model resolves from `claude/.claude/agents/<agent_type>.md` frontmatter
  verify: `python3 -m unittest -v scripts/tests/test_provenance_hook.py -k model`
- AC-3: `pi-view` writes a run-level ledger row parsed from `--model provider/id:thinking` and `--session-id`, without changing what it runs
  verify: `python3 -m unittest -v scripts/tests/test_pi_view_provenance.py`
- AC-4: The Codex observe hook adds `model` and `effort` to its record, falling back to config.toml values, then `unknown`
  verify: `python3 -m unittest -v scripts/tests/test_codex_provenance.py`
- AC-5: `commit-funnel` appends one `Agent:` and one `Agent-Paths:` trailer per model whose ledger rows cover the committed paths (Pi run rows cover every path under their worktree), in git and jj mode, leaving the rest of the message unchanged
  verify: `python3 -m unittest -v scripts/tests/test_commit_funnel.py -k provenance`
- AC-6: With no ledger rows for the committed paths, `commit-funnel` adds no `Agent:` trailers and prints one stderr line saying so
  verify: `python3 -m unittest -v scripts/tests/test_commit_funnel.py -k no_ledger`
- AC-7: Ledger writers prune rows older than 30 days
  verify: `python3 -m unittest -v scripts/tests/test_provenance_hook.py -k prune`
- AC-8: `scripts/provenance-report` prints, per model and effort per month, commits, files touched, and the share of those commits followed within 14 days by a revert or a commit touching the same paths, from git trailers only
  verify: `python3 -m unittest -v scripts/tests/test_provenance_report.py`
- AC-9: Existing commit-funnel tests still pass
  verify: `python3 -m unittest -v scripts/tests/test_commit_funnel.py`
  baseline: pass
- AC-10: The convention is documented where every harness reads it (shared/AGENTS.md and the Git history section of claude/.claude/rules/tool-routing.md), including that `Co-Authored-By` is not authoritative
  verify: `rg -q "Agent:" shared/AGENTS.md claude/.claude/rules/tool-routing.md`
- AC-11: The hook adds no noticeable latency to Write/Edit calls (runs async or in under 50 ms)
  verify: manual - timing judgement on a real session

## Boundaries
### Always
- Capture values from hooks, wrappers and config only; write `unknown` when a value is not observable
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
### Ask first
- Any change to prompts, rules or skills that asks a model to write provenance itself
- Committing the ledger anywhere, or keeping it longer than 30 days
- Touching agent-review, council or CI (v2 scope)
### Never
- Print secrets or config values other than model ids and effort levels
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- Trailer survival under `jj squash`: squash merges descriptions; do duplicate `Agent:` trailers need de-duplication at push time? Default: the funnel de-duplicates when it writes; re-check squash output in AC-5's jj test.
- Does Claude Code hook input carry the subagent's model directly? Default: no; resolve from agent frontmatter (AC-2), `unknown` for built-in agent types.
- Does Codex hook input include model/effort? Default: read config.toml; reading the session rollout JSONL is a v2 refinement.
- How the funnel finds "since the branch's previous commit": Default: ledger rows with `cwd` inside the worktree and `ts` after the HEAD commit's committer date.
- Very large commits (generated docs-site): Default: directory-compress `Agent-Paths` beyond 10 entries.
- v2: join agent-review verdicts, council verdicts and CI results onto `Agent:` trailers.
- Wiki: add a concept page describing the convention after implementation (llm-wiki).
