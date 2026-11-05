# Subspec 3: Measured pilot and operating runbook

Status: scoped; depends on verified phases 1 and 2. Owns root AC-7 through AC-9.

## Deliverable

Create `scripts/headroom-measure`, a stdlib Python CLI consuming JSONL samples
and printing a compact JSON comparison. Do not collect raw prompts or responses.
Required sample fields: workflow, provider, model, mode (direct/passthrough/cache),
run_id, turn, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
latency_ms, errors, and correctness (pass/fail/unverified). Define input_tokens as
total including cache reads and writes; compute uncached input by subtraction.
Reject negative, inconsistent, nonfinite or duplicate samples. Keep incomparable
providers/models/workflows separate; identify missing comparison modes and
incomplete correctness. Sum tokens/errors and report count and mean latency.

Money is optional: accept explicit per-million rates for uncached input, cache
reads, cache writes and output, with a stated pricing source and date. Omitted
rates produce unknown cost, never zero. Subscription runs must not be labelled
actual dollar savings. Report reductions only for matched, complete comparisons;
retain failed runs and do not call unverified results a win. Test this in
`scripts/tests/test_headroom_measure.py`, including a case where fewer input
tokens cost more because cache reads were lost.

Create `docs/headroom/runbook.md` covering version baseline, foreground service,
identity health check, aliases, retrieval connectivity, Pi extension loading,
safe queue examples, failure recovery and rollback. Do not globally export
provider base URLs. Explain why semantic caching is disabled and cache mode is
explicit. Link primary sources and record the installed/upstream default mismatch.

Create `docs/headroom/pilot-results.md`. Record offline evidence and a live
matrix for Claude, Codex CLI and Pi providers, testing multiple turns, tool calls,
cancellation, resume and parallel sessions; distinguish SSE from WebSocket.
Use one deterministic read-only task against the same fixture per comparison.
Track actual upstream cache counters, latency, retries, retrieval and correctness.
Explicitly mark unavailable auth, paid runs not authorized, or unavailable local
services as not run. No invented numbers, automatic warmers, retention changes,
or claim of proven savings from dashboard compression estimates.

## Phase exit

Run root spec check and floor-guard; report full output. Do not archive SPEC until
all required checks pass and work is ready for PR review. Push/merge and global
activation remain human decisions. A delivered opt-in pilot may have unverified
live routes, but those must remain marked experimental and cannot be recommended
as default until validated.
