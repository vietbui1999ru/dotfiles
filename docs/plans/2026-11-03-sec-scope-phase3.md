# Plan: sec-scope Phase 3 (AC-12 to AC-15, AC-17, AC-20)

You are implementing part of the approved spec `SPEC.md` at the repo root (branch
`feat/sec-scope`). Read `SPEC.md` first. Implement **only AC-12, AC-13, AC-14, AC-17, AC-20 and,
last, AC-15**. AC-16 is a manual check by the human: do not attempt it. Do not edit `SPEC.md`.

Phases 1 and 2 are done and are your toolkit: `scripts/secret-get` (one key by name; override
`SECRETS_ENV`), `scripts/with-secrets NAME... -- cmd args` (exits non-zero and does not run the
command when a key is missing), `scripts/redact`, `scripts/secret-scan`. Read them before starting.

## Hard rules
- Never read, print, copy or commit `~/secrets/.env`, not even to list its names. Tests use a
  temporary `.env` with fake values through the override variables (`SECRETS_ENV`,
  `PI_VIEW_SECRETS`). Build fake keys at runtime (`"sk-" + "a" * 32`).
- Tests first: write the failing test, run it, then implement. Existing tests keep passing
  **unchanged**, with the single exception named under AC-13.
- Resolve sibling scripts from the caller's own real path, never from `$HOME/dotfiles`, so the
  worktree copy is what runs under test. Config files that a client reads from `~` (settings.json,
  opencode.json, aliases.zsh) do use `$HOME/dotfiles/scripts/...`: that is the stowed install path.
- Do not touch `scripts/agent-review`, `pi/.pi/agent/extensions/agent-review/`, or any spec-loop
  text in `shared/AGENTS.md`.
- Commit after each AC group passes with `$HOME/dotfiles/scripts/commit-funnel --worktree
  /Users/vietquocbui/dotfiles/.claude/worktrees/sec-scope -F <msgfile> <paths>`. Never `git add -A`.

## AC-12: firecrawl MCP through `scripts/firecrawl-mcp`
`scripts/firecrawl-mcp` already exists (reads only `FIRECRAWL_API_KEY`, override
`FIRECRAWL_ENV_FILE`, runs `bunx firecrawl-mcp`). Do not change it.
- `claude/.claude/settings.json`, the `mcpServers.firecrawl` entry only (the spec says ask before
  any other change to this file). Keep `"command": "bash"`; replace the `args` with
  `["-c", "if [ \"${SEND_IT:-}\" = 1 ]; then export FIRECRAWL_ENV_FILE=\"$HOME/.config/send-it/.env\"; fi; exec \"$HOME/dotfiles/scripts/firecrawl-mcp\""]`.
  This keeps the send-it key file working and sources nothing.
- `opencode/.config/opencode/opencode.json`, the `firecrawl` entry: `"command": ["bash", "-c",
  "exec \"$HOME/dotfiles/scripts/firecrawl-mcp\""]`. Leave the other keys of that entry as they are.
  `scripts/sync-agent-rules.sh` merges `shared/mcp-servers.json` into this file; confirm by reading
  it that the sync does not rewrite or drop the firecrawl entry, and say so in your report.
- `shared/mcp-servers.json` line 4 (`_secrets`): reword so no `. ` precedes the path on that line,
  for example `"Values live in ~/secrets/.env and load per tool through scripts/secret-get; OpenCode expands {env:VAR} (no $), Pi sync transforms it to ${VAR}"`.
  The AC-12 verify regex `\. .*secrets/\.env` currently matches the old sentence.
- `claude/.claude/mcp-servers.json` line 3 (`_secrets`): replace "exported by .zshrc" with
  "loaded at start by the claude wrapper in zsh/.zsh/aliases.zsh (scripts/with-secrets)".
- Checks: both JSON files still parse (`python3 -m json.tool <file> >/dev/null`). Run the AC-12
  verify **and** a hidden-inclusive version, because plain `rg` skips `.claude`, `.config` and
  `.zshrc`:
  `! rg -n -uu 'source .*secrets/\.env|\. .*secrets/\.env' claude opencode pi codex zsh shared --glob '!**/node_modules/**'`.
  Before AC-15 the only allowed hit is `zsh/.zshrc`.

## AC-13: `scripts/pi-view` loads only Pi's keys
Test: `scripts/tests/test_pi_view_secrets.py`.
- Pi needs only `CONTEXT7_API_KEY` (from `~/.pi/agent/mcp.json`; Pi's provider key is in
  `~/.pi/agent/auth.json`). Replace the `set -a; source $secrets_file; set +a` block with a loop over
  a list holding just `CONTEXT7_API_KEY`: run the sibling `secret-get NAME` with
  `SECRETS_ENV=${PI_VIEW_SECRETS:-$HOME/secrets/.env}` and stderr discarded; on exit 0 export the
  value, otherwise skip it silently. `script_dir` is computed further down; move its computation
  above this block. Update the comment to say only Pi's keys load.
- **The one allowed test change:** in `test_secrets_reach_the_command`, `QUOTED` now must not
  reach the command. Change only the expected string to `"ctx7sk-test|unset|k"` and rename the
  test to `test_only_pis_keys_reach_the_command`. This is the AC-13 contract change, not a check
  being gamed. Keep `test_missing_secrets_file_still_runs` exactly as it is.
- Add: an inherited `QUOTED` in the caller's environment still reaches the command (pi-view does
  not scrub the environment, it only stops adding the file's other keys); and a file without
  `CONTEXT7_API_KEY` still runs with it unset and exit 0.
- `scripts/tests/test_pi_view_provenance.py` must still pass unchanged.

## AC-14 and AC-17: client wrappers in `zsh/.zsh/aliases.zsh`
New test: `scripts/tests/test_alias_secrets.py`. Run zsh with `-f` and a temporary `HOME`, source
the worktree `zsh/.zsh/aliases.zsh`, and put fake `claude`, `opencode`, `codex` and `headroom`
executables first on `PATH` that print `${CONTEXT7_API_KEY-unset}|${EXCALIDRAW_API_KEY-unset}|${OTHER-unset}`.
If sourcing the whole file needs things a bare test shell lacks, stub them; do not change
unrelated lines to make the test pass.
- Add a helper `_with_mcp_keys`: when `${SECRETS_ENV:-$HOME/secrets/.env}` is readable, run
  `"$HOME/dotfiles/scripts/with-secrets" CONTEXT7_API_KEY EXCALIDRAW_API_KEY -- "$@"`; otherwise
  run `command "$@"` (a machine with no secrets file still starts the client, without those MCP
  keys). Do not fall back when the file is readable but a key is missing: with-secrets' error
  naming the key is the intended signal.
- Define `claude`, `opencode` and `codex` as zsh **functions** that call
  `_with_mcp_keys <name> "$@"` (functions, not aliases, so they work in a non-interactive test
  shell; with-secrets execs the real binary from `PATH`, never the function). In the test, point
  the helper at the worktree `with-secrets` by setting `HOME` so that
  `$HOME/dotfiles/scripts/with-secrets` resolves to it (a symlink `$tmp/dotfiles` to the worktree
  root works).
- `hclaude` (AC-17): `alias hclaude="$HOME/dotfiles/scripts/headroom-prune; HEADROOM_TELEMETRY=off $HOME/dotfiles/scripts/with-secrets CONTEXT7_API_KEY EXCALIDRAW_API_KEY -- headroom wrap claude"`.
  No `umask`. Keep the surrounding `if command -v headroom` guard.
- Tests: with a fake file holding both keys plus `OTHER`, each of `claude`, `opencode`, `codex`
  prints both fake keys and `OTHER` unset; with no secrets file, each prints `unset|unset|unset`
  and exits 0; with a file missing `EXCALIDRAW_API_KEY`, the call exits non-zero and the fake
  binary did not run. For `hclaude`, assert the alias text with `alias hclaude` output (the
  headroom guard needs a fake `headroom` on `PATH` when sourcing).
- Verify lines: AC-14 `rg -q 'with-secrets' zsh/.zsh/aliases.zsh` and the AC-17 line in `SPEC.md`.

## AC-20: docs
- New `docs/workflows/secrets.md`: the convention in clear prose. Keys live in `~/secrets/.env`
  (mode 600), which nothing sources. `secret-get NAME` reads one key; `with-secrets NAME... --
  cmd` runs a command with only those keys; `redact` cleans text before it is logged or pushed;
  `secret-scan` and the pre-commit hook refuse a commit holding a key (`secret-scan: allow` for a
  deliberate fake key). A table of which tool loads which key: claude/opencode/codex (CONTEXT7,
  EXCALIDRAW via the aliases.zsh wrappers), hclaude (same two, telemetry off), pi-view (CONTEXT7),
  firecrawl MCP (FIRECRAWL via `scripts/firecrawl-mcp`). How to add a key for a new tool. Copy
  the "Human checklist" from `SPEC.md` as the at-rest checklist. Note that GUI-launched clients
  (Claude desktop, Orca) get no keys from shell wrappers.
- `shared/AGENTS.md`: add a short "Secrets" section (5 to 8 lines) pointing to that doc: never
  source or read `~/secrets/.env`; use `secret-get`/`with-secrets`; pass log text through
  `redact`; print names, never values. Place it outside the spec-loop block and do not alter that
  block.
- Verify: `rg -q 'secret-get' shared/AGENTS.md docs/workflows/secrets.md`.

## AC-15: the `.zshrc` cutover (last)
Do this only after AC-12, AC-13, AC-14 and AC-17 pass and are committed.
- `zsh/.zshrc`: delete line 62 (the `set -a; source "$HOME/secrets/.env"` line) and replace the
  comment above it (lines 59 to 61) with one comment saying keys load per tool, see
  `docs/workflows/secrets.md`. That comment must not contain the string `secrets/.env`.
- Before committing, search the repo for scripts that relied on the global export: `rg -n -uu`
  for `\$\{?(GITHUB_PAT|SHADCN_API_KEY|FIRECRAWL_API_KEY|CONTEXT7_API_KEY|EXCALIDRAW_API_KEY|OPENCODE_GO_API_KEY_[A-Z_]+|LITELLM_MASTER_KEY)\b`
  outside `scripts/secret-get`, `scripts/with-secrets`, tests and docs. **Report** each consumer
  with file:line and whether it already loads its own key; do not fix them in this run.
- Verify: `! rg -n 'secrets/\.env' zsh/.zshrc`, and the hidden-inclusive AC-12 check above now
  with no hits at all.

## Done when
All of these pass and you paste their output:
```
python3 -m unittest -v scripts/tests/test_pi_view_secrets.py scripts/tests/test_alias_secrets.py
python3 -m unittest discover -s scripts/tests
node --test scripts/mistake-fingerprint.test.mjs scripts/mistake-sync.test.mjs scripts/mistake-alert-hook.test.mjs
git ls-files -z | xargs -0 scripts/secret-scan
$HOME/dotfiles/scripts/spec check SPEC.md
$HOME/dotfiles/scripts/floor-guard
```
`spec check` will list AC-16 as manual; that is expected. End with the AC-15 consumer report.
Stop after these ACs. Do not push, and do not archive `SPEC.md`.
