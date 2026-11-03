---
status: draft
branch: feat/sec-scope
---
# SPEC: Scope secrets to the tool that needs them

## Objective
Stop API keys from reaching processes, logs, transcripts and pushed repos that do not need them.
Prompted by the 2026-10-29 pueue leak and a 2026-11-03 audit of dotfiles, llm-wiki and
agent-events (plan: `~/.claude/plans/investigate-the-dotfiles-llm-wiki-mutable-giraffe.md`).
Tool-to-tool transport is local (pueue unix socket 0700, loopback HTTP), so the fix is scope
and persistence, not transport encryption. Success: a new interactive shell holds no key values;
each tool loads only its own keys at run time; every log writer and auto-push path in this repo
redacts first; a commit containing a key is refused.

Decisions from the 2026-11-03 planning session:
- Backend: the plaintext file `~/secrets/.env`, parsed as `KEY=value` lines and never sourced.
  No Keychain, no external manager.
- One shared redactor (`scripts/redact`) replaces the scattered pattern lists.
- No new dependency: `scripts/secret-scan` (same patterns as `redact`) is the commit gate, not gitleaks.
- The `.zshrc` cutover lands last, after every consumer has its own loader.

## Acceptance Criteria
### Phase 1: building blocks
- AC-1: `scripts/secret-get NAME` prints exactly the value of NAME from `~/secrets/.env` (path overridable by `SECRETS_ENV`), handles quoted values and `export ` prefixes, never executes the file, exits 1 with a stderr message naming NAME when missing
  verify: `python3 -m unittest -v scripts/tests/test_secret_get.py`
- AC-2: `secret-get` refuses (exit 2, stderr reason) when the file is not mode 600 or its folder is not 700
  verify: `python3 -m unittest -v scripts/tests/test_secret_get.py -k mode`
- AC-3: `scripts/with-secrets NAME... -- cmd args` execs cmd with only the named keys added to the environment, and fails before exec if any key is missing
  verify: `python3 -m unittest -v scripts/tests/test_with_secrets.py`
- AC-4: `scripts/redact` (stdin to stdout) replaces every literal `.env` value and each pattern: `sk-`, `ghp_`/`gho_`/`github_pat_`, `AIza`, `fc-`, `xox[abp]-`, `AKIA`, `Bearer <tok>`, `Authorization:`/`X-Api-Key:` header values, `user:pass@` in URLs, `NAME=value` where NAME matches `(?i)(key|token|secret|pass|pat|auth)`, and short flags with glued values (`-pX`); fixtures cover each shape and leave ordinary text unchanged
  verify: `python3 -m unittest -v scripts/tests/test_redact.py`
- AC-5: `scripts/secret-scan [files...|-]` exits 1 and prints file:line plus the pattern name (never the value) for any literal `.env` value or any `redact` pattern tagged gate tier (token prefixes, auth header values, URL credentials); the broad redact-only rules (`NAME=value`, short-flag values) never fail it; a line containing `secret-scan: allow` is skipped; exits 0 on clean input
  verify: `python3 -m unittest -v scripts/tests/test_secret_scan.py`

### Phase 2: leaks that persist or leave the machine
- AC-6: `pueue-safe` finds the subcommand after global flags (`-c`, `--color`, `-p`, ...), strips secret-like names from `add`, refuses `env set` of a secret-like name, and warns on stderr when `.env` is unreadable
  verify: `python3 -m unittest -v scripts/tests/test_pueue_safe.py`
- AC-7: Existing pueue-safe behaviour is unchanged for plain `pueue add`
  verify: `python3 -m unittest -v scripts/tests/test_pueue_safe.py -k strips`
  baseline: pass
- AC-8: `mistake-fingerprint` drops leading `NAME=value` words and a leading `env`, reduces short flags to the bare flag, and runs `redact`'s patterns before returning
  verify: `node --test scripts/mistake-fingerprint.test.mjs`
- AC-9: `mistake-sync` runs `secret-scan` on staged files before commit and push, and stops without pushing on a hit
  verify: `node --test scripts/mistake-sync.test.mjs`
- AC-10: `enforce-bash-safety.sh` pipes its log entry through `scripts/redact`; state writers create files 600 and folders 700 (`umask 077`, `mode: 0o600`)
  verify: `python3 -m unittest -v scripts/tests/test_safety_log.py`
- AC-11: `scripts/link-git-hooks` installs a pre-commit hook that runs `secret-scan` on staged content and blocks on a hit
  verify: `python3 -m unittest -v scripts/tests/test_pre_commit_hook.py`

### Phase 3: per-tool loading and the cutover
- AC-12: The firecrawl MCP entries in `claude/.claude/settings.json` and `opencode/.config/opencode/opencode.json` launch `scripts/firecrawl-mcp`; no config in the repo sources `~/secrets/.env`
  verify: `! rg -n 'source .*secrets/\.env|\. .*secrets/\.env' claude opencode pi codex zsh shared`
- AC-13: `pi-view` loads only the keys Pi needs through `secret-get` and no longer sources the file
  verify: `python3 -m unittest -v scripts/tests/test_pi_view_secrets.py`
- AC-14: Clients whose MCP entries interpolate `${CONTEXT7_API_KEY}`/`${EXCALIDRAW_API_KEY}` (claude, opencode, codex) start through `with-secrets` from `zsh/.zsh/aliases.zsh`
  verify: `rg -q 'with-secrets' zsh/.zsh/aliases.zsh`
- AC-15: `zsh/.zshrc` no longer exports `~/secrets/.env`
  verify: `! rg -n 'secrets/\.env' zsh/.zshrc`
- AC-16: In a fresh login shell no `.env` value appears in the environment, and context7, excalidraw and firecrawl MCP calls still work from Claude, OpenCode and a `pi-view` pueue dispatch
  verify: manual - live shell and client check by the human

### Headroom (proxy between clients and model providers)
- AC-17: The `hclaude` alias starts Headroom with `umask 077` and `HEADROOM_TELEMETRY=off`, and through `with-secrets` with no keys, so the proxy and its children inherit none
  verify: `rg -q 'umask 077.*HEADROOM_TELEMETRY=off|HEADROOM_TELEMETRY=off.*umask 077' zsh/.zsh/aliases.zsh`
- AC-18: `scripts/headroom-prune` sets `~/.headroom` to 700 and its files to 600, and deletes `logs/debug_400/*.json` older than 7 days (these dumps hold full unredacted conversations); the `hclaude` alias runs it before each start
  verify: `python3 -m unittest -v scripts/tests/test_headroom_prune.py`
- AC-19: The ansible server note says to bind Headroom to 127.0.0.1 and expose it only through `tailscale serve` (HTTPS, tailnet-only), never plain HTTP on a LAN address
  verify: `rg -q 'tailscale serve' ansible/roles/agents/tasks/main.yml`

### Docs
- AC-20: The convention (secret-get / with-secrets / redact / secret-scan, never source the file) is documented in `shared/AGENTS.md` and `docs/workflows/secrets.md`, including the human at-rest checklist below
  verify: `rg -q 'secret-get' shared/AGENTS.md docs/workflows/secrets.md`

## Companion branches (same session, separate repos)
- llm-wiki `fix/leak-paths`: gitignore and `git rm --cached` `.council/` and `mistakes/raw-log.md`; council auto-commit opt-in; question on stdin; `NamedTemporaryFile`; `wiki-*` launch through `with-secrets OPENCODE_GO_API_KEY_LIGHTRAG`; `capture-bash-error.sh` calls `redact`; pre-commit `secret-scan`.
- agent-events `fix/redact`: `review.mjs` sends the prompt on stdin through `redact`; pre-commit `secret-scan`.

## Human checklist (not automated)
- Rotate GITHUB_PAT, SHADCN_API_KEY (found in opencode.db and one Pi session file) and FIRECRAWL_API_KEY (shell history).
- Delete that Pi session file and the history line.
- `~/.claude.json`: literal context7/github headers to `${VAR}`; `chmod 600` it, `~/.mcphub/servers.json`, `nvim/.config/nvim/.env`.
- Orca (`*:6768`) and Bartender (`*:7823`): bind to localhost in their settings if offered.
- Remove unused keys (OPENCODE_GO_API_KEY_PI_QUEUES, LITELLM_MASTER_KEY) from `.env` if truly unused.
- Kill the ~23 orphaned `headroom mcp serve` processes (each holds the full exported environment until the `.zshrc` cutover) and find which client leaves them behind.

## Boundaries
### Always
- Print key names, paths and counts only; never a value, in code, tests, logs or reports
- Use fake keys in fixtures, built at runtime so the fixtures themselves do not trip `secret-scan`
- Land Phase 3's `.zshrc` change last, after AC-12 to AC-14 pass
- Run `~/dotfiles/scripts/spec check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
### Ask first
- Rewriting git history of any repo (llm-wiki is public)
- Installing a new tool or dependency
- Changing Claude `settings.json` beyond the firecrawl MCP entry
### Never
- Read, print, copy or commit `~/secrets/.env` contents
- Run `spec approve`, `agent-review approve`, or edit a `verify:` line or test to pass

## Open Questions
- Which keys does Pi need inside `pi-view`? Default: CONTEXT7_API_KEY only (Pi's OpenCode Go key is in `~/.pi/agent/auth.json`); confirm from `~/.pi/agent/mcp.json`.
- Do Codex and OpenCode resolve `${VAR}` at client start or per MCP spawn? Default: client start, hence the alias wrapper; if per spawn, wrap the MCP command instead.
- GUI-launched clients (Claude desktop, Orca) have no shell aliases. Default: out of scope; they lose those MCP keys until a launcher exists. Flag on the use-test.
- `redact` literal-value pass needs `.env` readable; when it is not, patterns only, with one stderr warning.
