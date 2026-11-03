# Headroom pilot runbook

Operating guide for the opt-in shared Headroom proxy (phase 3, root AC-8). The
pilot is explicit and reversible: plain `claude`, `codex` and `pi` stay direct,
and only `hclaude` / `hcodex` / `hpi` or an explicit `PI_HEADROOM=1` touch the
proxy. Nothing in this document is a default, and no cell of the live matrix in
`pilot-results.md` is a measured saving yet.

## 1. Version baseline

Recorded in this worktree on 2026-11-03:

```
$ headroom --version
headroom, version 0.24.0
$ pi --version
1.4.0
$ python3 --version
Python 3.15.0
```

The compatibility claim is exactly this pair (`headroom 0.24.0`, `pi 1.4.0`).
Re-run both commands before trusting a live result and write down what you see;
an upgrade can move route defaults and WebSocket paths (see §8, §11).

**Installed/upstream mismatch.** The installed CLI reports
`--mode [token|cache] (default: token)`, while current upstream documentation
describes cache mode as the default. The pilot never relies on a default: the
launcher always passes `--mode cache` because `token` mode rewrites prior turns
and destroys the provider prefix cache this pilot exists to protect. Treat "the
defaults agree" as an assumption that must be re-checked on every upgrade.

## 2. What is exposed

| Entry point | What it does | Scope |
|---|---|---|
| `hclaude` | `headroom-workflow claude` | child env `ANTHROPIC_BASE_URL` only |
| `hcodex` | `headroom-workflow codex` | command-scoped `-c chatgpt_base_url` only (subscription auth) |
| `hpi` | `headroom-workflow pi` | child-only `PI_HEADROOM=1`, `PI_HEADROOM_URL` |
| `PI_HEADROOM=1` | Pi extension opt-in for pueue queues | one process |

The aliases live in the guarded block of `zsh/.zsh/aliases.zsh` and are only
defined when `headroom` is on `PATH`.

**Provider base URLs are never exported globally.** The launchers set their
routing variables in the child environment immediately before `execvpe`; the Pi
extension registers runtime provider overrides. The pilot writes none of
`~/.claude/settings.json`, `~/.codex/config.toml` or `~/.pi/agent/models.json`,
and `headroom wrap <tool>` is not part of it (it writes durable agent config and
can install context tools).

## 3. Start the proxy (foreground)

One terminal, one process, one worker, loopback only:

```bash
headroom-workflow proxy
```

That execs the fixed pilot policy — do not hand-type a variant unless you intend
to own the policy yourself:

```bash
OPENAI_TARGET_API_URL=https://opencode.ai/zen/go/v1 \
headroom proxy --host 127.0.0.1 --port 8787 --mode cache --workers 1 \
               --no-cache --no-telemetry
```

- `--mode cache`: freeze prior turns so provider prefix caches survive.
- `--no-cache`: disable the semantic *response* cache (not upstream prefix
  caching). On a proxy shared by several agents, one agent's prompt must never be
  answered from another agent's cached response.
- `--no-telemetry`, no `--memory`, no `--learn`, no `--log-messages`: the pilot
  does not enable memory, learning, telemetry or full message logging.
- `OPENAI_TARGET_API_URL` is pinned to OpenCode Go. Codex's ChatGPT traffic does
  not consult it (routing is auth-shape based, §8), so the pin only decides where
  non-ChatGPT OpenAI-shaped traffic goes.

The launcher refuses, before starting anything, a non-loopback or credentialed
`HEADROOM_WORKFLOW_URL`, a listener already on the port, an inherited
`OPENAI_TARGET_API_URL` that differs from the pin, and the feature switches
`HEADROOM_LOG_MESSAGES`, `HEADROOM_INTERCEPT_ENABLED`, `HEADROOM_PROXY_EXTENSIONS`
or any other `*_TARGET_API_URL`.

## 4. Identity health check

```bash
headroom-workflow status
# headroom-workflow: headroom-proxy 0.24.0 ready at http://127.0.0.1:8787
```

- `/livez` proves **identity**: `{"service":"headroom-proxy","alive":true,"version":"0.24.0"}`.
- `/readyz` proves **readiness**: HTTP 503 with `"ready": false` while unhealthy.
- `/health` **always returns HTTP 200**, healthy or not. It cannot prove which
  process is listening or whether it can serve traffic, so it is never the gate.

Manual check:

```bash
curl -s http://127.0.0.1:8787/livez | jq '{service, version, alive}'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/readyz
```

Every launcher calls the same check and exits 1 on a foreign or unready
listener. An unrelated service on the port must never receive provider
credentials, and there is no silent fallback to direct provider traffic: a
failed check means nothing launches.

Counters for a run live at the same origin: `/stats` (`requests`, `savings`,
`cost`, `by_provider`, `by_stack`), `/metrics` (Prometheus), `/stats-history`
(durable), and `headroom perf` over the proxy logs.

## 5. Opt-in interactive use

```bash
hclaude          # claude with child-scoped ANTHROPIC_BASE_URL
hcodex           # codex with -c chatgpt_base_url="{base}/backend-api/"
hpi              # pi with child-only PI_HEADROOM=1 and PI_HEADROOM_URL
```

Arguments and the child exit status pass through unchanged. Each launcher refuses
conflicting routing instead of silently overriding it:

- `hclaude`: an inherited `ANTHROPIC_BASE_URL`, or `env.ANTHROPIC_BASE_URL` in
  `~/.claude/settings.json` pointing somewhere else.
- `hcodex`: a stale `OPENAI_BASE_URL` still pointed at the proxy, a
  `chatgpt_base_url` / `model_provider` / `[provider].base_url` in
  `~/.codex/config.toml`, or a `-c` override naming those keys. Only the
  subscription surface is routed; an API-key override is refused by name (§9).
- `hpi`: an inherited `PI_HEADROOM_URL` describing a different proxy.

## 6. Pi extension loading

`pi/.pi/agent/extensions/headroom.ts` is inert unless `PI_HEADROOM` is truthy.
When enabled it registers partial overrides only — `{baseUrl, headers}`, no
`models`, `apiKey`, `oauth` or replacement stream handler — so catalog, OAuth,
native auth and compatibility settings survive:

| provider | baseUrl | stack slug |
|---|---|---|
| `anthropic` | `{base}` | `pi_claude` |
| `openai-codex` | `{base}/backend-api` | `pi_codex` |
| `opencode-go` | `{base}/v1` | `pi_opencode` |

`openai` is deliberately not registered: its API key belongs to a different
vendor than the pinned target, and routing it is the one misroute this design
must not create.

The extension throws on a non-loopback base or a failed `/livez` check, so Pi
startup stops instead of running with a half-registered map. `headroom-workflow pi`
passes `--extension <absolute path>` unless a stow copy at
`~/.pi/agent/extensions/headroom.ts` resolves to the same file, in which case Pi
already loads it and the flag is omitted — one load, never two.

## 7. Queue commands (pueue, pi-view)

A queue command carries `PI_HEADROOM=1` — a non-secret switch — and nothing else
new. No token, key, cookie or credentialed URL ever appears in a queue command.

```bash
# the opt-in switch, with the extension installed by stow
PI_HEADROOM=1 pi --model opencode-go/deepseek-v4.1-flash:medium -p '<task>'

# or through the launcher, which also preflights readiness
$HOME/dotfiles/scripts/headroom-workflow pi --model opencode-go/deepseek-v4.1-flash:medium -p '<task>'

# explicit path form when stow has not installed the extension
PI_HEADROOM=1 pi --extension "$HOME/dotfiles/pi/.pi/agent/extensions/headroom.ts" -p '<task>'
```

pi-view, pueue-safe, provider-governance, the queue templates and the review
hooks are not modified by this pilot, so a queue keeps its normal structure.

## 8. Retrieval connectivity

An existing Headroom MCP registration does **not** prove that retrieval traffic
goes through this proxy or that recovery reads the same store. Check it:

1. Tag the request. `x-headroom-stack` accepts `^[a-z][a-z0-9_]{0,63}$` —
   underscore slugs only (`llm_wiki_index`, `llm_wiki_chat`, `llm_wiki_mcp`,
   `pi_claude`, `pi_codex`, `pi_opencode`, `codex_cli`). A hyphenated value is
   dropped silently and the request lands unattributed.
2. Send one request, then read the counters:
   `curl -s http://127.0.0.1:8787/stats | jq '.requests.by_stack'` must show the
   tag. No tag, no attribution.
3. The llm-wiki scripts preflight `/livez` and take `WIKI_LLM_PROXY_URL`; keep
   their `x-opencode-session` value stable, because OpenCode Go refuses a request
   without it (`MissingSessionID`) and uses it for prefix-cache affinity.
4. Local retrieval (`qmd`) is unaffected and proves nothing about the proxy.
   Claim proxy-side recovery only after step 2 shows the traffic.

## 9. Measured findings that contradict the written plan

Measured on `headroom 0.24.0` / `pi 1.4.0`; they supersede the earlier plan text.

1. **`x-headroom-base-url` does not route `/v1/chat/completions`.** With the
   header set to the OpenCode Go base against a default-target proxy, the request
   reached `api.openai.com` carrying the OpenCode key. Only the catch-all
   `/{path:path}` route reads the header, and that path skips compression. The
   opencode-go route therefore rides the pinned target, never the header.
2. **ChatGPT routing is auth-shape based**, not path- or client-based: a
   `chatgpt-account-id` header or the JWT's `chatgpt_account_id` claim. Pi's
   `openai-codex` sends the header, so both it and the Codex CLI reach
   `chatgpt.com` regardless of `OPENAI_TARGET_API_URL`. Only `opencode-go`
   depends on that variable.
3. **Pi's `openai-codex` is WebSocket** on base + `/codex/responses`, and
   `/backend-api/codex/responses` is the only matching WS route headroom
   registers, so its base must be `{proxy}/backend-api`, not `/v1`.
4. **Stack slugs are `^[a-z][a-z0-9_]{0,63}$` and a rejected value is dropped
   silently** — `llm-wiki-index` loses attribution with no error. Also,
   `headroom proxy` defaults to `--mode token`, which rewrites prior turns and
   destroys the prefix cache the pilot exists to protect; hence the explicit
   `--mode cache`.
5. **Quota visibility is asymmetric.** Anthropic usage is polled from the cached
   `claudeAiOauth` credential, so it is visible without traffic; Codex usage is
   passive, parsed from `x-codex-*` response headers, so a direct Codex run is
   invisible in `/stats`. That is the only real argument for proxying the Codex
   CLI.

## 10. OpenAI API-key clients

Unsupported through this proxy, deliberately. The pinned target is OpenCode Go,
so an API-key OpenAI request would carry OpenAI credentials to a different
vendor. `hcodex` routes the subscription surface only and refuses an API-key
`-c openai_base_url` / `model_provider` override by name rather than rerouting
it. Pi's `openai` provider is left direct for the same reason.

If such a client ever needs proxying, run a **second proxy on another port with
default targets** and point only that client at it. Do not weaken the pin.

## 11. Failure recovery

| Symptom | Meaning | Action |
|---|---|---|
| `status`: "no proxy listening at …" | nothing on the port | start it (§3); launchers refuse, they never fall back to direct |
| `status`: "listener … is not Headroom" | a foreign service owns the port | stop it, or point `HEADROOM_WORKFLOW_URL` at a free loopback port |
| `status`: "not ready" | `/readyz` returned 503 | read the proxy's terminal log; do not route traffic |
| launcher: "refusing to launch … conflicting routing" | inherited or configured value points elsewhere | unset it; for Codex, `headroom unwrap codex` if a wrap left `openai_base_url` behind |
| Pi exits at startup with the extension enabled | non-loopback base or failed `/livez` | fix the URL, restart the proxy, retry |
| Codex fails at the first frame while readiness is green | WS route `/backend-api/codex/responses` missing after an upgrade | treat the route as failed; run plain `codex`; record it in `pilot-results.md` |
| proxy log says `Mode: token` | started by hand without `--mode cache` | stop it and use `headroom-workflow proxy`; token mode destroys the prefix cache |
| a `headroom wrap <tool>` process holds 8787 | not part of this pilot; it also runs in default mode | stop it in its own terminal, then re-run `headroom-workflow status` before trusting any number |

Measured example of that last row: on 2026-11-03 this machine had
`headroom wrap claude` running (`headroom.cli proxy --port 8787`, token mode) on
the pilot's port. A read-only check showed it had **not** written
`env.ANTHROPIC_BASE_URL` into `~/.claude/settings.json`, so the durable config was
intact; the process only occupied the port and made `headroom-workflow proxy`
refuse to start. Stop the wrapped process, do not work around the refusal.

## 12. Rollback

The pilot wrote no durable configuration, so rollback is stopping things rather
than undoing them:

1. Stop the proxy with Ctrl-C in the terminal that owns it. The operator owns
   that process; do not kill someone else's.
2. Go back to plain `claude`, `codex` and `pi`. They were never routed.
3. Hygiene: remove a stow copy at `~/.pi/agent/extensions/headroom.ts` (and its
   `lib/` sibling). It is inert without `PI_HEADROOM`, so this changes nothing
   functionally.
4. `git revert` the phase commits on `feat/headroom`. The only pre-existing file
   the pilot touches is the guarded alias block in `zsh/.zsh/aliases.zsh`.
5. Confirm nothing persisted: no `env.ANTHROPIC_BASE_URL` in
   `~/.claude/settings.json`, no `chatgpt_base_url` / `openai_base_url` pointing
   at port 8787 in `~/.codex/config.toml`, `~/.pi/agent/models.json` unchanged.

## 13. Measurement

Offline comparison tool (no provider calls):

```bash
headroom-measure samples.jsonl --pricing rates.json
```

- Samples are JSONL counters: `workflow`, `provider`, `model`, `mode`
  (`direct|passthrough|cache`), `run_id`, `turn`, `input_tokens`,
  `cache_read_tokens`, `cache_write_tokens`, `output_tokens`, `latency_ms`,
  `errors`, `correctness` (`pass|fail|unverified`), optional `billing`
  (`api|subscription`). Never prompts, never responses: a sample carrying a
  `prompt` or `response` key is refused by field name and its value is never
  echoed.
- `run_id` names one comparison run and is **shared** by that run's `direct`,
  `passthrough` and `cache` samples. The tool pairs modes on `(run_id, turn)`, so
  a distinct `run_id` per mode produces `no matched (run_id, turn) pairs` and a
  `withheld` verdict. Use one `run_id` per comparison, and one per parallel
  session.
- `input_tokens` is the total the provider saw; uncached input is
  `input_tokens - cache_read_tokens - cache_write_tokens`.
- Negative, inconsistent (uncached < 0), non-finite and duplicate
  `(workflow, provider, model, mode, run_id, turn)` samples are rejected with a
  line-numbered error.
- Money only from explicit per-million rates with a stated source and date;
  omitted rates are `"unknown"`, never 0; subscription billing is reported as
  `"subscription"`, never as dollars, and a mode mixing both billings is labelled
  `"mixed"` — still never priced, because one subscription sample is enough.
- Reductions only for matched, complete, passing comparisons; failed runs stay
  in the totals; unverified results are never a win.
- `errors` includes retries: every failed attempt on a turn counts. It is summed
  and reported per mode but is not used in the verdict, which rests on matched
  pairs, settled correctness, failed pairs and cost or uncached input. When a
  live cell is recorded, write the retry count as its own number in the cell's
  note (`pilot-results.md` §4).

The task definition, the offline evidence and the live matrix (all cells
`not run`) are in `pilot-results.md`.

## 14. Sources

- Headroom proxy: <https://github.com/headroomlabs-ai/headroom/blob/main/docs/content/docs/proxy.mdx>
  — Messages, Responses and Codex WS aliases; cache-aware replay.
- Headroom configuration: <https://github.com/headroomlabs-ai/headroom/blob/main/docs/content/docs/configuration.mdx>
  — per-request `x-headroom-base-url` routing (see §9.1 for what it does not do).
- OpenAI Codex configuration: <https://learn.chatgpt.com/docs/config-file/config-advanced>
  — built-in `openai_base_url` override; native auth must survive.
- OpenAI cache guidance: <https://developers.openai.com/api/docs/guides/prompt-caching>
  — stable history and tool definitions; pricing and retention depend on model and auth path.
- Pi provider overrides: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md>
  — `baseUrl`/`headers`-only registration preserves built-ins.
