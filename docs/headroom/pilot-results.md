# Headroom pilot results

Evidence record for phase 3 (root AC-8). Everything in §1 and §3 was produced by
a command in this worktree on 2026-11-03 with fixtures and isolated homes. Every
cell of the live matrix in §4 is `not run` and says why. There is no savings
claim in this document, and no number here comes from a dashboard compression
estimate.

Baseline for all of it: `headroom 0.24.0`, `pi 1.4.0` (see the runbook, §1).

## 1. Offline evidence

| Command | Result |
|---|---|
| `python3 scripts/tests/test_headroom_measure.py` | `Ran 22 tests in 1.677s` — `OK` |
| `node --test scripts/tests/headroom-*.test.mjs` | `tests 16` · `pass 16` · `fail 0` |
| `python3 -m unittest discover -s scripts/tests -p 'test_headroom*.py'` | `Ran 28 tests` — 26 pass, 2 fail (§2) |
| `python3 scripts/tests/test_headroom_measure.py`, after the §2 follow-up | `Ran 28 tests in 2.192s` — `OK` |
| `python3 -m unittest discover -s scripts/tests -p 'test_headroom*.py'`, after the §2 follow-up | `Ran 34 tests in 8.996s` — `OK` |

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
duplicates, subscription labelling, unverified results, failed pairs, float and
non-finite token counts, a `prompt`/`response` sample being refused without echoing
its value, `mixed` billing never priced, and a no-pricing regression decided on
uncached input.

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
was edited: the only failing assertion in each is that refusal message. A
read-only check of `~/.claude/settings.json`
after the wrap showed no `env.ANTHROPIC_BASE_URL`, so no durable Claude routing was
left behind. Stopping the wrapped process is the operator's call (runbook §11).

**Resolution (same day, AC-9).** The two cases were isolated rather than the
assertions relaxed. Each now passes an explicit free-port loopback origin
(`HEADROOM_WORKFLOW_URL=http://127.0.0.1:<free port>`) and asserts that port, so
no case depends on a port it does not own. Coverage of the default is kept: one
case loads `scripts/headroom-workflow` in-process with `SourceFileLoader` and
asserts `DEFAULT_URL` is `http://127.0.0.1:8787` and that resolving an env without
the variable yields that port and the loopback bind host — no socket is opened on
8787. The forbidden flags, `HOME`, absent env vars, snapshot equality, loopback
host, "already listening" refusal, inherited-switch refusals and the pinned
OpenAI target are unchanged. Re-run with the owner's listener still live on 8787:
`Ran 34 tests in 8.996s` — `OK`.

## 3. Measurement tool on a deterministic fixture

Fixture 1 — two matched turns, `direct` vs `cache`, API-billed so the rates apply.
Its four lines are the JSONL below, which is the whole fixture: it is not
tracked, so recreate it from the inline JSONL rather than looking for
`/tmp/f1.jsonl` on another machine.

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
# both paths are recreated from this document: the JSONL above, and this
# rate JSON written to /tmp/demo-rates.json
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
(two lines, recreated from this JSONL; not tracked), the case that must never
become a win:

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

Run on 2026-11-03 with `headroom 0.42.0` (installed; the spec baseline is 0.24.0,
see §8.1), `pi 1.4.0`, `claude 2.1.317`, `codex-cli 0.166.0`. The cache proxy ran
on CACHE_PORT 18100 and the passthrough proxy on PASS_PORT 18101 (both loopback,
both started by the operator-authorised agent; the owner's listener on 8787 was
never touched). Authorization: owner, 2026-11-03, for small subscription calls.
Full evidence and exact commands are in §8.

Reason codes (updated for this run):

- **R1** — paid runs: lifted for this run by owner authorization, so cells are
  run where a route works.
- **R2** — auth unavailable: Pi `anthropic` OAuth refresh fails on this machine.
- **R3** — local service: resolved for this run (both proxies started by the agent).
- **R4** — needs an interactive TUI the agent cannot drive non-interactively.
- **R5** — transport needs a live upstream; here the live upstream was reached.

Cell legend: `pass` / `fail (<error>)` / `not run (<reason>)`. Retries are counted
in the note; `errors` in the samples is 0 for every recorded turn, because a
failed attempt is never written as a sample (§8.4).

| Client | Multi-turn (t1+t2) | Tool calls | Cancellation | Resume | Parallel sessions | SSE vs WebSocket |
|---|---|---|---|---|---|---|
| Claude (`hclaude`) | pass — 3 modes × 2 turns, all correct; claude-sonnet-4-6 | pass — 2 tool calls on turn 1 (the two reads), 0 on turn 2 | pass — SIGINT, client exit 0, proxy ready, fresh call correct | pass — `--resume <sid>` turn 2 correct, cache_read present | pass — 2 concurrent cache-mode sessions, both correct, distinct sids | SSE `/v1/messages` (cache proxy log: 13 responses, all 200; the 27 log lines include request and response entries) |
| Codex CLI (`hcodex`) | **fail** — passthrough and cache: `workspace backend must use an HTTPS origin without credentials` (CLI refuses plain-HTTP loopback `chatgpt_base_url`); direct pass | not run (no proxied turn completed) | not run (no proxied turn completed) | not run (no proxied turn completed) | not run (no proxied turn completed) | WebSocket `/v1/responses` → `wss://chatgpt.com/backend-api/codex/responses` seen at the proxy, but the client never completed a turn through it |
| Pi `anthropic` (`hpi`) | **not run (R2)** — `OAuth refresh failed for anthropic` (token refresh to platform.claude.com failed); tried once in probe and once in the cell | not run (R2) | not run (R2) | not run (R2) | not run (R2) | not run (R2): no `/v1/messages` request from Pi reached the proxy |
| Pi `openai-codex` (`hpi`, gpt-6.1-sol) | pass — 3 modes × 2 turns, all correct | pass — tool calls on turn 1 (2–3 per run), 0 on turn 2 | not run — not included in this pass (see note) | pass — turn 2 with `--session-id` correct, cache_read present | pass — 2 concurrent cache-mode sessions, both correct | WebSocket `/backend-api/codex/responses` (cache proxy log: 4 `WS /v1/responses` connections forwarded to `/backend-api/codex/responses`), not SSE |
| Pi `opencode-go` (`hpi`, deepseek-v4.1-flash) | pass — 3 modes × 2 turns, all correct (passthrough rerun after the pin fix, §8.3) | pass — 2–8 tool calls on turn 1, 0 on turn 2 | pass — SIGINT rc -2, proxy ready, fresh call correct | pass — turn 2 correct, cache_read present | pass — 2 concurrent cache-mode sessions, both correct | SSE `/v1/chat/completions` (cache proxy log: 17 inbound requests, all 200) |

Notes that bind the table:

- **Passthrough log.** The passthrough proxy was restarted with the OpenCode pin
  (§8.3), which cleared its earlier log, so the first Claude passthrough cell's
  traffic is not in the current log. A fresh Claude passthrough call was then
  verified to reach PASS_PORT (`/v1/messages`, 200). The cell's recorded tokens
  come from the run's own usage output, not from that log.
- **Pi `openai-codex` cancellation** was not run in this pass (`not run`, not
  implied by the other cells).
- **Codex** is the one route with a real client-side fail: the CLI rejects a
  plain-HTTP loopback `chatgpt_base_url` ("must use an HTTPS origin"). The proxy
  itself received the WebSocket and forwarded it. Until the CLI accepts a loopback
  origin, `hcodex` is not a working route on this build. Record it as
  **experimental-fail**, not as a pilot pass.
- **Pi `anthropic`** is blocked by auth, not by the proxy: its cells stay
  `not run (R2)`, as the owner predicted.
- **Attribution gap:** `/stats` `requests.by_stack` attributed only `pi_opencode`
  (17 requests). The `pi_openai` WebSocket and Claude requests reached the proxy
  but carry no `x-headroom-stack` tag on that path, so they are unattributed in
  `by_stack`. The runbook's §8 check is therefore **not met** for those routes.

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
you called a search tool or only read files." Expected answer: the same AC count
and the same quoted sentence as turn 1, exactly the two paths above, and "only
read files" — this turn calls no tool.

**Turn 3.** "List the exact tool calls you made in this session, in order." This
turn is `unverified` by design: the expected order is one read of `SPEC.md` then
one read of `docs/headroom/03-measurement.md`, but each client renders tool names
and arguments differently, so there is no authoritative transcript to compare
against. Record it as `unverified` rather than inventing an expected string; a
turn 3 answer that contradicts turn 2's path list is still a `fail`.

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
`workflow` = the task slug, `provider`/`model` as used, `mode`, `run_id`, `turn`
1–3, the four token counters from the provider's usage payload, `latency_ms`,
`errors`, `correctness`, and `billing` (`api` or `subscription`).

`run_id` names one comparison run and is **shared** by that run's `direct`,
`passthrough` and `cache` samples: the tool pairs modes on `(run_id, turn)`, so
the three modes must carry the same `run_id` for the same prompts. A distinct
`run_id` per mode yields zero matched pairs and the verdict `withheld` with
`no matched (run_id, turn) pairs`. Use a fresh `run_id` for each comparison and
for each parallel session, so two sessions never share turn keys.

`errors` counts every failed attempt on a turn, retries included. It is summed
and reported per mode, but it does not enter the verdict: the verdict rests on
matched pairs, settled correctness, failed pairs and cost or uncached input. The
retry count itself, broken out from other errors, belongs in the live-cell notes
(§4). Then:

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
- No claim that any route is production-ready: all five clients are experimental.
- No claim that Codex works through the proxy: it fails on this build (§4, §8.3).
- No claim of a token or cost reduction from the 2026-11-03 run; its verdicts are
  no change or regression (§8.6).

## 7. Reproduce

```bash
python3 scripts/tests/test_headroom_measure.py
python3 -m unittest discover -s scripts/tests -p 'test_headroom*.py'
node --test scripts/tests/headroom-*.test.mjs
```

Nothing under `/tmp` is tracked. The §3 fixtures are recreated from the inline
JSONL printed there (`/tmp/f1.jsonl`, `/tmp/f2.jsonl`) and the rate file from the
inline rate JSON above (`/tmp/demo-rates.json`); the paths appear only because
that is where the recorded run wrote them. Nothing else is needed.

`scripts/tests/__pycache__/` is build output, covered by the repository's
`__pycache__/` ignore rule; it is never committed.

## 8. Live run record (2026-11-03)

### 8.1 Versions and commands

- `headroom` **0.42.0** (installed at `~/.local/share/uv/tools/headroom-ai/bin`,
  not on PATH). This is NOT the 0.24.0 baseline in the spec; the runbook's version
  claim is out of date and must be re-verified.
- `pi` 1.4.0, `claude` 2.1.317, `codex-cli` 0.166.0.
- Cache proxy (CACHE_PORT 18100): `HEADROOM_WORKFLOW_URL=http://127.0.0.1:18100
  scripts/headroom-workflow proxy`. The launcher's `--mode cache`, `--no-cache`,
  `--no-telemetry`, one worker, pinned `OPENAI_TARGET_API_URL=https://opencode.ai/zen/go/v1`.
- Passthrough proxy (PASS_PORT 18101): `OPENAI_TARGET_API_URL=https://opencode.ai/zen/go/v1
  headroom proxy --host 127.0.0.1 --port 18101 --no-optimize --workers 1 --no-cache
  --no-telemetry` (the launcher has no passthrough option). Log shows
  `Optimization: DISABLED`; the banner still prints `Mode: cache`, which is expected.
- Both proxies were stopped at the end of the run. Port 8787 (the owner's
  `headroom wrap claude`, PID 6458) was never touched.
- Fixture: `git archive HEAD` of `feat/headroom` at `ed29409`, extracted to
  `/tmp/hr-smoke/fixture` and given a local git repo (so the Pi agent-review
  extension does not log git errors). All clients ran from there.

### 8.2 Model ids

Claude `claude-sonnet-4-6` (passed `--model`; confirmed in the stream). Codex CLI:
the CLI default, not reported by `exec --json`, so recorded as `codex-default`.
Pi `anthropic/claude-sonnet-4-6`, `openai-codex/gpt-6.1-sol`,
`opencode-go/deepseek-v4.1-flash`.

### 8.3 Findings that changed the run

1. The first passthrough proxy was started without the OpenCode target pin. Its
   `opencode-go` traffic went to `api.openai.com` and returned HTTP 401, giving
   0-token `fail` cells. That is the runbook §9.1 misroute. The proxy was restarted
   with the pin, and the `opencode-go` passthrough cells were rerun and then pass.
   The failed 401 samples were discarded, never written to the samples file.
2. Codex through either proxy mode fails with `workspace backend must use an
   HTTPS origin without credentials`. The CLI rejects the plain-HTTP loopback base.
3. Pi `anthropic` fails at OAuth refresh (`OAuth refresh failed for anthropic`).
4. Error turns (`stopReason: error`) are counted as failed attempts, never as
   samples; a parser that accepted them would have produced fake zero-token samples.

### 8.4 Retries and errors

No client retried a turn in a way the parsers counted (`retries` is 0 for every
recorded turn). Failed codex attempts were not written as samples, so `errors`
is 0 in the samples file; the failures are recorded in §4 and §8.3.

### 8.5 `/stats` deltas

`requests.by_stack` on the cache proxy: `{"pi_opencode": 5}` before the comparison
(from the probe calls); `{"pi_opencode": 17}` after the run. Those are the only stack
tags recorded. No other stack tag appeared,
because the other routes' requests carry no `x-headroom-stack` tag. Attribution
is therefore only evidenced for `pi_opencode`.

### 8.6 Samples and measure output

Samples file: 20 lines, counters only (no prompts or responses). Claude
(`direct`, `passthrough`, `cache`) and Pi `openai-codex` and `opencode-go` each
have 3 modes × 2 turns. Codex has only `direct` (its proxied modes failed), so its
comparison is withheld. The measure tool ran with no `--pricing` (all routes are
subscription, so there are no dollar claims):

Verdicts as the tool stated them:

- claude: cache vs direct `no change`; passthrough vs direct `no change`.
- codex: `missing_modes` passthrough and cache, so no comparison.
- pi_openai: cache vs direct `regression`; passthrough vs direct `regression`.
  The tool's note: fewer total input tokens, but cache reads fell (42624 to 40320),
  so uncached input rose (1079 to 3022).
- pi_opencode: cache vs direct `regression` (tool note: fewer total input tokens but
  a higher bill); passthrough vs direct `regression`.

These are n=2 turns per mode on a prefix cache, so the variance is larger than the
differences. None of them is a reduction. The honest reading is that this run
shows no proven savings, and some regressions in cache reads.

### 8.7 Gates

- `python3 -m unittest discover -s scripts/tests -p 'test_headroom*.py'`: Ran 34 tests, OK.
- `node --test scripts/tests/headroom-*.test.mjs`: tests 16, pass 16, fail 0.
- `spec check SPEC.md`: AC-1..AC-7 and AC-9 PASS; AC-8 MANUAL (expected). Approved 2026-11-02.
- `floor-guard`: `INFO SPEC.md status: none -> approved`, rc 0.
