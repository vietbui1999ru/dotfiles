# Provenance implementation plan (Pi handoff)

You are implementing the approved SPEC.md at the root of this worktree (branch
`feat/provenance`). Read SPEC.md first; work only toward its AC ids and obey its
Boundaries. The design below was reviewed and approved by the human.

## Rules for this run

- Work only inside this worktree. Do not create another worktree or branch.
- Commit each coherent unit through the funnel only:
  `$HOME/dotfiles/scripts/commit-funnel --worktree "$PWD" -F <message file> <path>...`
  Write the message file under `$TMPDIR`, not in the repo.
- Never edit a `verify:` line in SPEC.md, and never weaken a test to make it pass.
- Never run `ac-run approve`. Do not push.
- Python: stdlib only (Python 3.15; `tomllib` is available). Shell: keep each file's existing shell.
- `codex/.codex/hooks/observe-session.sh` does not exist in the repo yet. Its current live
  content is copied verbatim below; create it from that and then apply the edit in section 3.
- Suggested commit order: (1) scripts/provenance + its tests, (2) pi-view, (3) codex hook,
  (4) settings.json, (5) commit-funnel + tests, (6) provenance-report + tests, (7) docs.
- Before finishing run every `verify:` command from SPEC.md (AC-1 to AC-10) and
  `$HOME/dotfiles/scripts/floor-guard`, and paste the output in your final message.

## Components

### 1. `scripts/provenance` (new, python, stdlib) — the one ledger writer
Subcommands: `hook` (Claude stdin JSON), `pi-run --cwd D -- <pi argv>`, `codex` (Codex stdin JSON).
- Ledger: `$PROVENANCE_LEDGER` else `$HOME/.local/state/provenance/ledger.jsonl`. Session state:
  `$HOME/.local/state/provenance/sessions/<session>.json`.
- Row: exactly the 10 spec fields; missing -> `"unknown"`. `ts` UTC ISO-8601 `Z`.
- Append: one `os.write` of a full line with O_APPEND. Prune rows with ts older than 30 days,
  at most once a day (stamp file `.pruned`), under `fcntl.flock`, rewrite via temp + rename.
- Never prints; every exception swallowed, exit 0.
- Claude `hook`: by `hook_event_name`:
  - SessionStart: write state `{model, harness_version}`; model = `anthropic/<model>` if present;
    version from `claude --version` (timeout 2 s) else unknown.
  - PostModelSwitch: update state model from `to_model`.
  - PostToolUse (Write/Edit/MultiEdit): row with path `tool_input.file_path`, op = tool name
    lowercased, effort `effort.level` / `$CLAUDE_EFFORT`, role = `agent_type` or `main`.
    Subagent model: `model:` frontmatter of `<agents dir>/<agent_type>.md`
    (`$PROVENANCE_AGENTS_DIR` else `<script dir>/../claude/.claude/agents`); `inherit` ->
    session model; bare id -> `anthropic/<id>`; missing file -> `unknown`.
- `pi-run`: parse `--model provider/id[:thinking]` and `--session-id`; row
  `path="*"`, `cwd`=realpath of D, `harness=pi`, version `pi --version` (timeout 2 s) else unknown,
  role `dispatch`, op `run`.
- `codex`: model/effort from input if present else `$CODEX_HOME|~/.codex/config.toml`
  (`tomllib`): model = `<model_provider or openai>/<model>`, effort `model_reasoning_effort`,
  else unknown. Prints `model<TAB>effort` on stdout for the caller (captured, not hook stdout).
  For `apply_patch`, one row per `*** Add|Update|Delete File:` / `*** Move to:` path
  (relative to input `cwd`), role `main`, harness `codex`.

### 2. `scripts/pi-view` (edit, ~3 lines)
After the `session_id` loop, before either `exec`:
`"$script_dir/provenance" pi-run --cwd "$PWD" -- "$@" >/dev/null 2>&1 || true`
(move `script_dir=` above it). Argv untouched.

### 3. `codex/.codex/hooks/observe-session.sh` (new in repo = current file + edit)
Copy `~/.codex/hooks/observe-session.sh`; before the printf:
`IFS=$'\t' read -r MODEL EFFORT < <(printf '%s' "$INPUT" | "$HOME/dotfiles/scripts/provenance" codex 2>/dev/null)`;
default each to `unknown`; add `"model"`, `"effort"` to the JSONL record. Script path via
`$PROVENANCE_BIN` override for tests. hooks.json untouched (same path after stow).

### 4. `claude/.claude/settings.json` (edit, append-only)
Add `"$HOME/dotfiles/scripts/provenance" hook` entries: SessionStart, PostModelSwitch,
PostToolUse matcher `Write|Edit|MultiEdit`, each `"async": true`.

### 5. `scripts/commit-funnel` (edit)
- `provenance_trailers(root, rels)`: read ledger (skip bad lines); lower bound = `git log -1
  --format=%cI HEAD` (none on empty repo). Match: `path=="*"` rows whose realpath(cwd) is root or
  under it cover all rels; else realpath(join(cwd, path)) relative to root in rels.
- Group by model; other fields joined distinct with `,`; `paths=<n>`.
  `Agent-Paths: <model> a, b` — over 10: collapse to parent dirs (`dir/`), still over 10 -> first component.
- Append with `git interpret-trailers --if-exists addIfDifferent --trailer ...` (handles existing
  Co-Authored-By block and jj-squash de-dup). git mode: commit `-F` a temp file holding the new
  text; jj mode: pass new text to `jj commit -m`.
- No rows: stderr `commit-funnel: no provenance ledger rows for the committed paths; no Agent: trailers added`, message untouched.
- Docstring: "never rewrites the message text" -> "only appends Agent trailers".

### 6. `scripts/provenance-report` (new, python)
`provenance-report [--repo DIR]`: `git log --format=%H%x00%cI%x00%s%x00%(trailers:key=Agent,valueonly,separator=%x01) --name-only`.
Per (model, effort, YYYY-MM): commits, distinct files, follow-up share = commits with a later commit
within 14 days that is a revert of it (`This reverts commit <sha>` or subject `Revert`) or touches
any same path. Plain aligned table on stdout.

### 7. Docs (AC-10)
Short paragraph in the Git history sections of `shared/AGENTS.md` and
`claude/.claude/rules/tool-routing.md`: Agent:/Agent-Paths: trailers are tool-written by
commit-funnel from the ledger, the query command, Co-Authored-By is display-only and not
authoritative, models never write provenance. Spec-loop blocks untouched.

### 8. Tests (stdlib unittest, temp HOME, `PROVENANCE_LEDGER` env)
- `scripts/tests/test_provenance_hook.py`: AC-1 (10 fields, unknowns, empty stdout), AC-2 names
  contain `model` (state file, PostModelSwitch, agent frontmatter, inherit, missing), AC-7 `prune`.
- `scripts/tests/test_pi_view_provenance.py`: AC-3 (row fields; command output unchanged).
- `scripts/tests/test_codex_provenance.py`: AC-4 (input > config.toml > unknown; record fields;
  apply_patch rows).
- `scripts/tests/test_commit_funnel.py`: add `test_provenance_*` (git + jj, Pi `*` row, multiple
  models, compression, Co-Authored-By preserved, jj squash de-dup check) and `test_no_ledger_*`.
- `scripts/tests/test_provenance_report.py`: AC-8 on a temp repo with trailered commits + follow-ups.

## Assumptions (recorded here, not in the approved SPEC.md)
Codex provider prefix = `model_provider` else `openai`; Pi role = `dispatch`; versions via
`--version` with 2 s timeout.

## Verification
- `~/dotfiles/scripts/ac-run check SPEC.md` (AC-1..10) and `~/dotfiles/scripts/floor-guard`; paste both.
- Manual AC-11: after merge + restow, run a Claude session, Edit a file, confirm ledger row and no
  perceptible delay; commit via funnel and check `git log -1 --format=%B` shows `Agent:`.
- Not Pi's job: archiving SPEC.md under `docs/specs/` and opening the PR happen after review.

## Post-merge (user)
Trash `~/.codex/hooks/observe-session.sh`, restow codex; Claude settings follow stow automatically.

## Appendix: current ~/.codex/hooks/observe-session.sh

```bash
#!/usr/bin/env bash
# PostToolUse hook — append {ts, tool, session, ok} to session JSONL log.
# Never blocks (always exits 0). Log path: ~/.claude/logs/session-YYYYMMDD.jsonl

INPUT=$(cat)

TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null)
SESSION=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null)
# tool_response is an object; presence of error key or non-zero exit signals failure
OK=true
if echo "$INPUT" | jq -e '.tool_response.error' &>/dev/null; then
	OK=false
fi

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/session-$(date -u +%Y%m%d).jsonl"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"ts":"%s","tool":"%s","session":"%s","ok":%s}\n' \
	"$TS" "$TOOL" "$SESSION" "$OK" >>"$LOG_FILE"

# Universal inbox: also save to .agents/sessions/ via agent-session (lightweight,
# non-blocking; best-effort — never fails the hook). Keeps Codex sessions in the
# same universal inbox as cc/opencode/pi. Legacy logging above is unchanged.
if command -v agent-session >/dev/null 2>&1; then
	STATE_BODY="## Session log entry\n- ts: $TS\n- tool: $TOOL\n- session: $SESSION\n- ok: $OK\n"
	printf '%s' "$STATE_BODY" | agent-session save --harness codex --work-type general --kind session --goal "codex session $SESSION" --body - >/dev/null 2>&1 || true
fi

exit 0
```
