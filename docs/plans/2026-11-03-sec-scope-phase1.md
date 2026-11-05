# Plan: sec-scope Phase 1 (AC-1 to AC-5)

You are implementing Phase 1 of the approved spec `SPEC.md` at the repo root (branch
`feat/sec-scope`). Read `SPEC.md` first. Implement **only AC-1 to AC-5**. Do not touch any other
file than those listed below. Do not edit `SPEC.md`.

## Hard rules
- Never read, print, copy or commit `~/secrets/.env`. Every test uses a temporary `.env` with fake
  values, passed through the override variable. Build fake key strings at runtime in tests
  (for example `"sk-" + "a" * 32`), so the test source itself contains no key-shaped literal.
- Write tests first (TDD), run them, see them fail, then implement.
- Commit after each AC passes with `$HOME/dotfiles/scripts/commit-funnel --worktree <this worktree> -F <msgfile> <paths>`.
  Never `git add -A`.

## Conventions to copy
- Shell shims: POSIX `#!/bin/sh`, `PATH="$PATH:/usr/bin:/bin"`, header comment explaining why.
  Reference: `scripts/firecrawl` lines 1-23 (reads ONE key with sed, never sources the file).
- Tests: `python3 -m unittest`, in `scripts/tests/`, running the script via `subprocess` with a
  minimal env (`PATH=/usr/bin:/bin`, `HOME=<tmp>`). Reference: `scripts/tests/test_pueue_safe.py`
  and `scripts/tests/test_pi_view_secrets.py`.

## Files
| AC | Script | Test |
|---|---|---|
| AC-1, AC-2 | `scripts/secret-get` (sh) | `scripts/tests/test_secret_get.py` |
| AC-3 | `scripts/with-secrets` (sh) | `scripts/tests/test_with_secrets.py` |
| AC-4 | `scripts/redact` (python3, stdlib only) | `scripts/tests/test_redact.py` |
| AC-5 | `scripts/secret-scan` (python3, stdlib only, imports patterns from redact) | `scripts/tests/test_secret_scan.py` |

## Details
- **secret-get NAME**: file = `${SECRETS_ENV:-$HOME/secrets/.env}`. Handles `export NAME=`, single
  and double quotes, CRLF; last definition wins. Missing NAME: exit 1, stderr
  `secret-get: NAME not found` (name only). AC-2: if the file mode is not 600 or its parent folder
  not 700, exit 2 with a stderr reason; test names must contain `mode` (spec runs `-k mode`).
  Use `stat -f %Lp` on macOS and `stat -c %a` on Linux (detect, do not assume).
- **with-secrets NAME... -- cmd args**: for each NAME call `secret-get`; if any fails, exit with
  its code before running cmd. Then `exec env NAME=value ... cmd args`. Must not add any other key
  from the file. Test: the child prints its env; assert only the named fake keys are present.
- **redact**: stdin to stdout. Literal pass: replace every value (length >= 8) from the secrets
  file (same override `SECRETS_ENV`) with `[REDACTED:NAME]`; if the file is unreadable, one stderr
  warning and pattern pass only. Pattern pass, replacing the value with `[REDACTED]` while keeping
  the prefix/name visible: `sk-…`, `ghp_`/`gho_`/`github_pat_`, `AIza…`, `fc-…`, `xox[abp]-…`,
  `AKIA…`, `Bearer <tok>`, `Authorization:`/`X-Api-Key:` header values, `user:pass@` in URLs,
  `NAME=value` where NAME matches `(?i)(key|token|secret|pass|pat|auth)`, short flag with a glued
  value of 6+ chars (`-pXXXXXX` becomes `-p[REDACTED]`; do NOT touch `-la`, `-rf`, `-m`-with-space).
  Expose the compiled pattern list as a module-level `PATTERNS` (name, regex) so secret-scan can
  import it (`importlib` from the script path, the file has no `.py` suffix). Tests: one per
  shape, plus ordinary text (code, paths, git output, `ls -la`) unchanged.
- **secret-scan [files...|-]**: exits 1 and prints `file:line: <pattern-name>` for each match,
  never the value; exits 0 when clean. `-` or no args reads stdin (label `<stdin>`).

## Done when
```
python3 -m unittest -v scripts/tests/test_secret_get.py scripts/tests/test_with_secrets.py scripts/tests/test_redact.py scripts/tests/test_secret_scan.py
```
passes, every existing test in `scripts/tests/` still passes (`python3 -m unittest discover -s scripts/tests`),
and `scripts/secret-scan $(git diff --name-only origin/main)` exits 0. Stop after Phase 1;
report the test output.
