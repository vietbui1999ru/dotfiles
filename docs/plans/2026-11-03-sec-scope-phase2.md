# Plan: sec-scope Phase 2 (AC-6 to AC-11, AC-18, AC-19)

You are implementing part of the approved spec `SPEC.md` at the repo root (branch
`feat/sec-scope`). Read `SPEC.md` first. Implement **only AC-6, AC-7, AC-8, AC-9, AC-10, AC-11,
AC-18 and AC-19**. Do not edit `SPEC.md`. AC-12 to AC-17 and AC-20 are a later phase: do not
touch `zsh/.zshrc`, `pi-view`, MCP configs, or the `umask`/telemetry part of the `hclaude` alias.

Phase 1 is done and is your toolkit: `scripts/secret-get`, `scripts/with-secrets`,
`scripts/redact` (stdin to stdout; `PATTERNS` plus the `GATE_PATTERNS` tier) and
`scripts/secret-scan` (gate tier plus literal `.env` values; skips lines containing
`secret-scan: allow`). Read all four before starting.

## Hard rules
- Never read, print, copy or commit `~/secrets/.env`. Tests use a temporary `.env` with fake
  values passed through the override variable (`SECRETS_ENV`, `PUEUE_SAFE_SECRETS`). Build fake
  keys at runtime (`"sk-" + "a" * 32`) so test source holds no key-shaped literal.
- Tests first: write the failing test, run it, then implement. Every existing test must keep
  passing **unchanged**; you may only add tests. Exception: the fixture-marker step below.
- Do not run `scripts/link-git-hooks` against the real repo. Tests point `DOTFILES` and git at
  temporary directories.
- Resolve sibling scripts from the caller's own real path (as `with-secrets` does with
  `$(dirname "$0")`, or `import.meta.url` in Node), never from `$HOME/dotfiles`, so the worktree
  copy is what runs under test.
- Commit after each AC group passes with `$HOME/dotfiles/scripts/commit-funnel --worktree
  /Users/vietquocbui/dotfiles/.claude/worktrees/sec-scope -F <msgfile> <paths>`. Never `git add -A`.

## AC-6, AC-7: `scripts/pueue-safe` (zsh)
Test file: `scripts/tests/test_pueue_safe.py` (add tests; keep the existing ones as they are).
- **Global flags:** find the subcommand after pueue's global options. The flags that take a value
  are `-c`/`--config`, `-p`/`--profile` and `--color` (also the `--flag=value` forms). Flags with
  no value: `-v`, `-vv`, `-h`, `--help`, `-V`, `--version`. `pueue --color never add -- x` and
  `pueue -c cfg add -- x` must strip secrets exactly like `pueue add -- x`.
- **`env set`:** `pueue [globals] env set <task-id> <NAME> <value>`: when NAME is secret-like (in
  the secrets file, or matching `is_secret`), print `pueue-safe: refusing to store secret-like
  variable NAME` (name only) to stderr and exit 2 without running pueue. Other names pass through.
- **Names:** extend `is_secret` with these suffixes, matched case-insensitively: `_APIKEY`,
  `_PAT`, `_PASS`, `_PASSWD`, `_AUTH_TOKEN`, `_ACCESS_KEY`. Keep every existing rule. Use suffixes
  only, never substrings: the existing test requires `SSH_AUTH_SOCK`, `MAX_THINKING_TOKENS`,
  `HERDR_PANE_ID`, `PATH` and `HOME` to survive.
- **Unreadable secrets file:** keep dropping by pattern (existing test), and also print one stderr
  line `pueue-safe: warning: secrets file unreadable; dropping by name pattern only`. The exit
  code stays 0.

## AC-8: `scripts/mistake-fingerprint.mjs`
Test: `node --test scripts/mistake-fingerprint.test.mjs` (add tests to that file).
- In `commandShape`, before picking the program, drop leading words that match
  `^[A-Za-z_][A-Za-z0-9_]*=` and a leading `env` (also `env` followed by such words).
  `FOO_KEY=x curl -s u` gives `curl -s`; `env A=1 git push` gives `git push`.
- Reduce a short flag with a glued value to the bare flag: a token matching `^-[A-Za-z]` (not
  `--`) longer than 2 characters becomes its first 2 characters (`-pSECRET` becomes `-p`). Long
  flags keep the existing `=...` drop. The existing tests must still pass (`rg -n foo src` gives
  `rg -n`).
- Last, pass the final shape string through `scripts/redact` (`spawnSync('python3', [redactPath],
  {input})`, path resolved from `import.meta.url`). If that call fails or exits non-zero, return
  the program word only. Add a test where a token-shaped word survives in a subcommand position
  (for example `gh <fake ghp_ token>`) and assert the fake value is absent.

## AC-9: `scripts/mistake-sync.mjs`
Test: `node --test scripts/mistake-sync.test.mjs` (add tests).
- In `sync`, after `git add events` and before `commit`: list the staged files
  (`git -C repo diff --cached --name-only`) and run `scripts/secret-scan` on them with
  `cwd: repo` (`execFileSync`, path from `import.meta.url`). On exit 1, unstage
  (`git -C repo reset -q events`), throw an `Error` whose message contains `secret-scan` and the
  pattern names from its output but no values, and do not commit or push.
- Test: a temporary git repo with a bare remote, and an alerts file whose fingerprint holds a fake
  `sk-` key. Assert that `sync` throws, the remote has no new commit, and the local HEAD did not
  move. Add a clean-alert case that commits and pushes to the bare remote.

## AC-10: state redaction and modes
Test: `python3 -m unittest -v scripts/tests/test_safety_log.py` (add tests).
- `claude/.claude/hooks/enforce-bash-safety.sh`: keep the jq `redact` exactly as it is, and pipe
  the finished JSON line through `scripts/redact` before appending (`… | "$redact" >>"$log"`).
  Resolve `$redact` relative to the hook's real path (the hook is reached through a stow link;
  resolve with `cd -P`/`pwd -P` on its directory). If `scripts/redact` is missing, fall back to
  the jq-only line; never skip logging. Set `umask 077` inside the logging block so the log folder
  is 700 and the log files are 600.
- New tests: a command containing a fake `AIza…` key, a fake `fc-…` key and
  `curl -u user:pw@x` is absent from the log entry; the log file is mode 600 and its folder 700.
- `scripts/mistake-alert-hook.mjs` (and any helper it calls that writes
  `~/.claude/state/mistake-*.json`): create the state folder with `mode: 0o700` and write the files
  with `mode: 0o600`. Add a test in `scripts/mistake-alert-hook.test.mjs` with a temporary state
  folder: the state paths come from `os.homedir()`, which reads `HOME`, so run the hook with `HOME`
  set to a temporary directory. Do not add a new override variable.

## AC-11: pre-commit hook
Test: new `scripts/tests/test_pre_commit_hook.py`, in the style of `test_post_commit_hook.py`.
- New `scripts/hooks/pre-commit` (sh): for each staged file
  (`git diff --cached --name-only --diff-filter=ACMR -z`), scan the **staged** content
  (`git show ":$f" | secret-scan -`), print hits with `<stdin>` replaced by the file path, and exit
  1 if any file hit. Find `secret-scan` relative to the hook's real path (it is a symlink into
  `scripts/hooks/`). Print one closing line naming the bypass: `git commit --no-verify` for a
  deliberate fake key, or add `secret-scan: allow` to that line.
- `scripts/link-git-hooks`: add `pre-commit` to the hook-name loop. No other change.
- Tests: a staged fake key blocks the commit; a clean commit passes; a key present only in the
  working tree but not staged does not block; a line with `secret-scan: allow` passes.
- **Fixture markers:** these existing fake-key lines fail the gate. Append a trailing comment
  `secret-scan: allow` to each line (`#` in Python, `//` in TypeScript), changing nothing else:
  `scripts/tests/test_safety_log.py` (the `secrets = [...]` list near line 66-67),
  `scripts/tests/test_redact.py` (the url-userinfo case near line 105),
  `pi/.pi/agent/extensions-available/provider-governance/test/phase-3.test.ts` (lines near 80
  and 112), `session-band-plugin/hooks/forge.test.ts` (line near 17), and any line your own new
  tests add. Done when `git ls-files -z | xargs -0 scripts/secret-scan` exits 0.

## AC-18: `scripts/headroom-prune` (sh)
Test: new `scripts/tests/test_headroom_prune.py`.
- Directory `${HEADROOM_DIR:-$HOME/.headroom}`; exit 0 silently if it does not exist. Set the
  directory and every subdirectory to 700 and every file to 600. Delete
  `logs/debug_400/*.json` older than 7 days (`find … -mtime +7`). Print nothing on success.
- `zsh/.zsh/aliases.zsh`: change only the `hclaude` line to run the prune first:
  `alias hclaude="$HOME/dotfiles/scripts/headroom-prune; headroom wrap claude"`.
- Tests: modes after a run, an 8-day-old dump deleted, a 1-day-old dump kept, a missing directory
  exits 0.

## AC-19: ansible note
`ansible/roles/agents/tasks/main.yml`, in the comment above the Headroom task: say to bind the
proxy to `127.0.0.1` (`--host 127.0.0.1`) and expose it to other machines only through
`tailscale serve` (HTTPS, tailnet-only), never as plain HTTP on a LAN address. Comment only.

## Done when
All of these pass and you report their output:
```
python3 -m unittest -v scripts/tests/test_pueue_safe.py scripts/tests/test_safety_log.py scripts/tests/test_pre_commit_hook.py scripts/tests/test_headroom_prune.py
node --test scripts/mistake-fingerprint.test.mjs scripts/mistake-sync.test.mjs scripts/mistake-alert-hook.test.mjs
python3 -m unittest discover -s scripts/tests
git ls-files -z | xargs -0 scripts/secret-scan
rg -q 'tailscale serve' ansible/roles/agents/tasks/main.yml
```
Stop after these ACs.
