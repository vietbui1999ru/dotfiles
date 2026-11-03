# Headroom pilot results

Evidence record for phase 3 (root AC-8). Everything in §2–§4 was produced by a
command in this worktree on 2026-11-03 with fixtures and isolated homes. Every
cell of the live matrix in §5 is `not run` and says why. There is no savings
claim in this document, and no number here comes from a dashboard compression
estimate.

Baseline for all of it: `headroom 0.24.0`, `pi 1.4.0` (see the runbook, §1).

## 1. Offline evidence

| Command | Result |
|---|---|
| `python3 scripts/tests/test_headroom_measure.py` | `Ran 22 tests in 1.677s` — `OK` |
| `node --test scripts/tests/headroom-*.test.mjs` | `tests 16` · `pass 16` · `fail 0` |
| `python3 -m unittest discover -s scripts/tests -p 'test_headroom*.py'` | `Ran 28 tests` — 26 pass, 2 fail (§3) |

Test-first record for the measurement tool: the 22 tests were written first and
run against a missing file, giving `FAILED (failures=29)` across the 22 tests and
their sub-cases, each with
`can't open file '…/scripts/headroom-measure': [Errno 2] No such file or directory`.
After implementation the same file reported `Ran 22 tests … OK`. No existing test
was edited; one assertion inside the new subscription test was tightened from a
fragile `"0.0" not in output` check to asserting the absence of `"total"`,
`"currency"` and `"per_million"`, which is the contract that test exists to hold.

The measurement tests cover, by name: cache regression (fewer input tokens, higher
cost), kept cache reads (a real reduction), unknown and partial prices, unmatched
runs, invalid counts, inconsistent uncached input, non-finite latency,
duplicates, subscription labelling, unverified results and failed pairs.

## 2. Gate environment finding

While these runs were taken, an unrelated `headroom wrap claude` process held the
pilot's port: `headroom.cli proxy --port 8787`, token mode, PID 6458, started by
`headroom wrap claude` (not by this pilot; the pilot's launcher passes
`--mode cache`). Two phase 1 cases, `test_proxy_policy` and
`test_proxy_pins_openai_target`, start `headroom-workflow proxy` on the default URL
and assert the resulting policy argv, so they correctly refuse:

```text
headroom-workflow: something is already listening at http://127.0.0.1:8787;
refusing to start a second proxy.
```

That is the refusal path working, not a regression in phase 3, and neither test
was edited. They pass on a free port. A read-only check of `~/.claude/settings.json`
after the wrap showed no `env.ANTHROPIC_BASE_URL`, so no durable Claude routing was
left behind. Stopping the wrapped process is the operator's call (runbook §11).

## 3. Measurement tool on a deterministic fixture

Fixture 1 — two matched turns, `direct` vs `cache`, API-billed so the rates apply
(`/tmp/f1.jsonl`):

```jsonl
{"workflow":"demo-readonly","provider":"anthropic","model":"claude-x","mode":"direct","run_id":"a1","turn":1,"input_tokens":12000,"cache_read_tokens":0,"cache_write_tokens":0,"output_tokens":800,"latency_ms":1800,"errors":0,"correctness":"pass","billing":"api"}
{"workflow":"demo-readonly","provider":"anthropic","model":"claude-x","mode":"direct","run_id":"a1","turn":2,"input_tokens":20000,"cache_read_tokens":0,"cache_write_tokens":0,"output_tokens":900,"latency_ms":2200,"errors":0,"correctness":"pass","billing":"api"}
{"workflow":"demo-readonly","provider":"anthropic","model":"claude-x","mode":"cache","run_id":"a1","turn":1,"input_tokens":12000,"cache_read_tokens":11000,"cache_write_tokens":0,"output_tokens":800,"latency_ms":1500,"errors":0,"correctness":"pass","billing":"api"}
{"workflow":"demo-readonly","provider":"anthropic","model":"claude-x","mode":"cache","run_id":"a1","turn":2,"input_tokens":20000,"cache_read_tokens":19000,"cache_write_tokens":0,"output_tokens":900,"latency_ms":1700,"errors":0,"correctness":"pass","billing":"api"}
```

```json
{"source":"offline fixture rates (illustrative, not a price list)","date":"2026-11-03","currency":"USD","per_million":{"uncached_input":3.0,"cache_read":0.3,"cache_write":3.75,"output":15.0}}
```

```bash
scripts/headroom-measure /tmp/f1.jsonl --pricing /tmp/demo-rates.json
```

Output, verbatim (one compact line; wrap it for reading):

```json
{"groups":[{"comparisons":[{"baseline":"direct","baseline_only":0,"basis":"cost","complete":true,"delta":{"cache_read":{"baseline":0,"delta":30000,"percent":null,"variant":30000},"cache_write":{"baseline":0,"delta":0,"percent":null,"variant":0},"cost":{"baseline":0.1215,"delta":-0.081,"percent":-66.67,"variant":0.0405},"output":{"baseline":1700,"delta":0,"percent":0.0,"variant":1700},"total_input":{"baseline":32000,"delta":0,"percent":0.0,"variant":32000},"uncached_input":{"baseline":32000,"delta":-30000,"percent":-93.75,"variant":2000}},"failed_pairs":0,"matched_pairs":2,"unverified_pairs":0,"variant":"cache","variant_only":0,"verdict":"reduction"}],"missing_modes":["passthrough"],"model":"claude-x","modes":{"cache":{"billing":"api","correctness":{"fail":0,"pass":2,"unverified":0},"correctness_complete":true,"cost":{"currency":"USD","date":"2026-11-03","per_million":{"cache_read":0.3,"cache_write":3.75,"output":15.0,"uncached_input":3.0},"source":"offline fixture rates (illustrative, not a price list)","total":0.0405},"count":2,"errors":0,"mean_latency_ms":1600.0,"tokens":{"cache_read":30000,"cache_write":0,"input":32000,"output":1700,"uncached_input":2000}},"direct":{"billing":"api","correctness":{"fail":0,"pass":2,"unverified":0},"correctness_complete":true,"cost":{"currency":"USD","date":"2026-11-03","per_million":{"cache_read":0.3,"cache_write":3.75,"output":15.0,"uncached_input":3.0},"source":"offline fixture rates (illustrative, not a price list)","total":0.1215},"count":2,"errors":0,"mean_latency_ms":2000.0,"tokens":{"cache_read":0,"cache_write":0,"input":32000,"output":1700,"uncached_input":32000}}},"provider":"anthropic","workflow":"demo-readonly"}],"samples":4}
```

What it shows: total input is identical (32000 → 32000) while uncached input falls
32000 → 2000 because cache reads appear (0 → 30000). At the fixture rates the
matched, complete, passing comparison is a `reduction` on the `cost` basis:
0.1215 → 0.0405. Those are fixture numbers, not provider prices — the rate file
says so, and the tool copies that source and date into its output.

Fixture 2 — one matched pair with an unverified result on subscription billing
(`/tmp/f2.jsonl`), the case that must never become a win:

```jsonl
{"workflow":"demo-readonly","provider":"openai-codex","model":"gpt-5","mode":"direct","run_id":"b1","turn":1,"input_tokens":9000,"cache_read_tokens":0,"cache_write_tokens":0,"output_tokens":700,"latency_ms":2100,"errors":0,"correctness":"pass","billing":"subscription"}
{"workflow":"demo-readonly","provider":"openai-codex","model":"gpt-5","mode":"cache","run_id":"b1","turn":1,"input_tokens":9000,"cache_read_tokens":8000,"cache_write_tokens":0,"output_tokens":700,"latency_ms":1900,"errors":0,"correctness":"unverified","billing":"subscription"}
```

```json
{"groups":[{"comparisons":[{"baseline":"direct","baseline_only":0,"basis":null,"complete":false,"delta":null,"failed_pairs":0,"matched_pairs":1,"reason":"1 unverified pair(s)","unverified_pairs":1,"variant":"cache","variant_only":0,"verdict":"withheld"}],"missing_modes":["passthrough"],"model":"gpt-5","modes":{"cache":{"billing":"subscription","correctness":{"fail":0,"pass":0,"unverified":1},"correctness_complete":false,"cost":"subscription","cost_reason":"subscription billing is not metered in dollars; token counts only","count":1,"errors":0,"mean_latency_ms":1900.0,"tokens":{"cache_read":8000,"cache_write":0,"input":9000,"output":700,"uncached_input":1000}},"direct":{"billing":"subscription","correctness":{"fail":0,"pass":1,"unverified":0},"correctness_complete":true,"cost":"subscription","cost_reason":"subscription billing is not metered in dollars; token counts only","count":1,"errors":0,"mean_latency_ms":2100.0,"tokens":{"cache_read":0,"cache_write":0,"input":9000,"output":700,"uncached_input":9000}}},"provider":"openai-codex","workflow":"demo-readonly"}],"samples":2}
```

What it shows: `cost` is `"subscription"`, not a dollar figure; `correctness_complete`
is false for the cache mode; the comparison is `withheld` with the reason
`1 unverified pair(s)` and `delta: null`. Token counts are still reported, because
they are measured; the verdict is not.

## 4. Live matrix

Every cell is `not run`. Reason codes:

- **R1** — paid runs not authorized: the spec puts paid API experiments beyond
  small pilot calls behind "ask first", and no such authorization exists for this
  run.
- **R2** — auth not available to the agent: no auth file may be read and no
  credential printed for this work, so the agent cannot obtain a live session.
- **R3** — local service not started by the agent: the proxy is the operator's
  foreground process, and port 8787 was held by a foreign `headroom wrap claude`
  process during these runs (§2).
- **R4** — needs an interactive TUI session the agent cannot drive here.
- **R5** — the transport claim (WebSocket/SSE) needs a live upstream; a mock
  cannot prove it.

| Client | Multi-turn | Tool calls | Cancellation | Resume | Parallel sessions | SSE vs WebSocket |
|---|---|---|---|---|---|---|
| Claude (`hclaude`) | not run (R1, R3, R4) | not run (R1, R3, R4) | not run (R3, R4) | not run (R1, R3, R4) | not run (R1, R3) | not run (R1, R3) |
| Codex CLI (`hcodex`) | not run (R1, R3, R4) | not run (R1, R3, R4) | not run (R3, R4) | not run (R1, R3, R4) | not run (R1, R3) | not run (R3, R5) |
| Pi `anthropic` (`hpi`) | not run (R1, R2, R3) | not run (R1, R2, R3) | not run (R2, R3) | not run (R1, R2, R3) | not run (R1, R2, R3) | not run (R2, R3) |
| Pi `openai-codex` (`hpi`) | not run (R1, R2, R3) | not run (R1, R2, R3) | not run (R2, R3) | not run (R1, R2, R3) | not run (R1, R2, R3) | not run (R3, R5) |
| Pi `opencode-go` (`hpi`) | not run (R1, R3) | not run (R1, R3) | not run (R3) | not run (R1, R3) | not run (R1, R3) | not run (R1, R3) |

A live cell is only recorded once it has all of: upstream cache counters
(`cache_read`, `cache_write`) from the provider's own usage payload, total input,
output, latency, retry count, retrieval result, correctness against the fixed
expected answer, and the transport actually used. A green `/readyz` is not a live
result — the WebSocket route can be missing while readiness passes (runbook §11).

## 5. Deterministic read-only comparison task (for the owner)

One task, one fixture, one expected answer; no network, no writes, no paid work
beyond the runs themselves.

**Fixture.** This worktree at a fixed commit. The task only reads two tracked
files, so it cannot drift:

- `SPEC.md`
- `docs/headroom/03-measurement.md`

**Task (turn 1).** "In this worktree, count how many acceptance criteria in
`SPEC.md` have ids of the form `AC-<number>`, and quote the first sentence of the
`## Phase exit` section of `docs/headroom/03-measurement.md`. Report both, and the
paths you read."

**Turn 2.** "Restate both answers, list every file path you read, and say whether
you called a search tool or only read files."

**Turn 3.** "List the exact tool calls you made in this session, in order."

**Expected answer.** The AC count in `SPEC.md` (9 at this commit) and the Phase
exit sentence starting "Run root spec check and floor-guard". Correctness is
`pass` only for an exact match, `fail` otherwise, `unverified` when no
authoritative check was made. Because the task is read-only and file-pinned, a
compressed or cache-rewritten context that damages the prefix shows up as a wrong
answer, not as a smaller bill.

**Modes.** Run the same prompts three times, same model, same worktree commit,
same stable session id (never per-PID, or the prefix cache has nothing to hit):

1. `direct` — plain client, no proxy.
2. `passthrough` — proxy started with `--no-optimize`.
3. `cache` — proxy started with `--mode cache`.

**Recording.** One JSONL sample per turn, written with the schema in runbook §13:
`workflow` = the task slug, `provider`/`model` as used, `mode`, `run_id` (one per
run, distinct across parallel sessions), `turn` 1–3, the four token counters from
the provider's usage payload, `latency_ms`, `errors` (retries count here),
`correctness`, and `billing` (`api` or `subscription`). Then:

```bash
scripts/headroom-measure samples.jsonl --pricing rates.json
```

**What counts as a win.** A `reduction` verdict from the tool: matched turns in
both modes, settled correctness, no failed pairs, and a lower cost — or, when no
prices are supplied, lower uncached input, which is a token result and must be
labelled as one. Fewer total input tokens alone is not a win; the tool reports
that combination as a `regression` when the bill rises. Subscription runs never
produce a dollar claim.

**Also record, per run:** `/stats` `requests.by_stack` (the tag must appear) and
the cache counters before and after, so attribution is evidenced rather than
assumed. No cache warmers, no retention changes, no semantic-cache reuse.

## 6. Not claimed

- No savings figure, percentage or "X% cheaper" statement for any real provider.
- No claim that Headroom's dashboard compression estimate is a saving.
- No claim that an existing MCP registration means retrieval goes through this
  proxy (runbook §8 has the check).
- No claim that any route is production-ready: all five clients are experimental
  until their matrix cells are filled in.

## 7. Reproduce

```bash
python3 scripts/tests/test_headroom_measure.py
python3 -m unittest discover -s scripts/tests -p 'test_headroom*.py'
node --test scripts/tests/headroom-*.test.mjs
```

The fixtures in §3 are the files named there; the rate file is the illustrative
one printed above. Nothing else is needed.
