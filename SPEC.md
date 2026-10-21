---
status: draft
branch: feat/safety-block-log
---
# SPEC: A block log that humans trace and judge (bash-safety, part C)

## Objective
Every command `enforce-bash-safety.sh` blocks leaves a redacted, traceable record, and a human can review the records, mark each block as the right call or a false positive, and see the open ones from the session-band. Agents already learn the reason at once through stderr (PR #160, part A). This log is for the human side of the loop. Success: after an agent's command is blocked, `safety-log` in a terminal shows when, which session and worktree, which rule and the redacted command; `safety-log mark <id> false-positive` records the human verdict; the session-band shows a ⛔ count of this session's unjudged blocks.

### Decisions
- D1: The hook appends one JSON object per block to `${SAFETY_LOG_DIR:-$HOME/.claude/state}/bash-safety-blocks.jsonl`. Fields: `id` (12 hex characters), `ts` (local ISO 8601), `session` (the payload's `session_id`), `cwd`, `transcript` (the payload's `transcript_path`), `rule` (a short stable id per check, such as `git-clean-force`), `command`, `reason` (the first line of the block message). Allowed commands write nothing.
- D2: Secrets are redacted before anything is written: GitHub tokens (`ghp_`, `gho_`, `ghs_`, `github_pat_`), `sk-` keys, `Bearer <token>`, AWS access key ids (`AKIA…`), and the value of any `NAME=value` assignment whose name contains `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD` or `KEY`. Each is replaced with `[REDACTED]`. The rest of the command is kept in full, since that is what makes a block traceable, up to a 4000-character safety cap with a `…[truncated]` marker.
- D3: Logging can never weaken the guard. If the log cannot be written, the block still happens with the same exit code and the same reason on stderr.
- D4: When the log passes 2000 entries it is moved to `bash-safety-blocks.jsonl.1`, replacing any older `.1`, and a new log starts.
- D5: Human verdicts live in a separate append-only file, `bash-safety-verdicts.jsonl` (`{"id","verdict","ts"}`, verdict `ok` or `false-positive`, last one wins), so the hook and the CLI never rewrite the same file.
- D6: `scripts/safety-log` (Python, standard library only) is the main way to trace. With no arguments it lists the newest entries first, one line each (time, session id shortened to 8, rule, verdict or `pending`, command). Filters: `--session ID`, `--rule RULE`, `--since 1h|2d|<ISO date>`, `--pending`. `--json` prints the filtered entries, verdict included, as one JSON array. `show ID` prints one entry in full (reason, cwd, transcript path). `mark ID ok|false-positive` records a verdict. `--false-positives` lists false-positive counts per rule, the input for a human rule change.
- D7: The session-band shows a `⛔N` chip only when this session has N > 0 blocks with no verdict. Pressing it opens a Blocks pane listing this session's blocks (time, rule, command). In the pane, `o` marks the selected block `ok`, `f` marks it `false-positive`, both through `safety-log mark`, and the list refreshes. No Neovim view.
- D8: Build split: the hook change (D1-D4) is the review gate, so Claude builds it. The CLI (D5-D6) and the band (D7) may be dispatched to Pi.

## Acceptance Criteria
- AC-1: A blocked command appends exactly one entry with every D1 field; an allowed command appends nothing
  verify: `python3 -m unittest scripts.tests.test_safety_log.HookLog.test_block_appends_one_entry scripts.tests.test_safety_log.HookLog.test_allowed_appends_nothing`
- AC-2: Secrets in a blocked command are redacted as in D2, the rest of the command is kept, and a command over 4000 characters is truncated with the marker
  verify: `python3 -m unittest scripts.tests.test_safety_log.HookLog.test_redaction scripts.tests.test_safety_log.HookLog.test_truncation`
- AC-3: With an unwritable log directory, the block still exits 2 with its reason on stderr and empty stdout
  verify: `python3 -m unittest scripts.tests.test_safety_log.HookLog.test_unwritable_log_still_blocks`
- AC-4: At 2000 entries the next block rotates the log to `.1` and starts a new one holding only the new entry
  verify: `python3 -m unittest scripts.tests.test_safety_log.HookLog.test_rotation`
- AC-5: `safety-log` lists newest first and each filter (`--session`, `--rule`, `--since`, `--pending`) narrows the list
  verify: `python3 -m unittest scripts.tests.test_safety_log.Cli.test_list_and_filters`
- AC-6: `safety-log mark ID ok|false-positive` records the verdict and the listing shows it; an unknown id exits 2 and writes nothing
  verify: `python3 -m unittest scripts.tests.test_safety_log.Cli.test_mark`
- AC-7: `safety-log show ID` prints the entry's reason, cwd and transcript path; `--json` prints one array with verdicts; `--false-positives` counts per rule
  verify: `python3 -m unittest scripts.tests.test_safety_log.Cli.test_show_json_false_positives`
- AC-8: The band shows `⛔N` for this session's unjudged blocks and nothing when N is 0
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "\(pass\) safety blocks chip counts this session's pending blocks"`
- AC-9: In the Blocks pane, `o` and `f` record the verdict for the selected block through `safety-log mark` and the list refreshes
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "\(pass\) blocks pane marks the selected block"`
- AC-10: Existing session-band tests still pass
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "^ *0 fail$"`
  baseline: pass
- AC-11: The commit-funnel tests, which load the hook, still pass
  verify: `python3 -m unittest scripts/tests/test_commit_funnel.py`
  baseline: pass
- AC-12: A workflow doc describes the log location and fields, the redaction, `safety-log` usage and the verdict loop
  verify: `rg -q "bash-safety-blocks.jsonl" docs/workflows/bash-safety-log.md && rg -q "safety-log mark" docs/workflows/bash-safety-log.md`
- AC-13: Use-test: a real agent session gets a command blocked; `safety-log` shows it with the right session and redacted command; marking it in the band pane clears the chip
  verify: manual - live session with a real block

## Boundaries
### Always
- Tests point `SAFETY_LOG_DIR` at a temporary directory; never read or write the real log from a test
- Keep every existing block pattern, exit code and stderr reason unchanged
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
### Ask first
- Any new block rule or a change to an existing pattern
- Logging allowed commands, or sending log data anywhere off the machine
### Never
- Let a verdict, the log or the band allow a blocked command; verdicts only inform a human-written rule change
- Pi edits `enforce-bash-safety.sh` (it is the gate that reviews Pi)
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- Should the chip count this session's unjudged blocks or all sessions'? Default: this session's; `safety-log --pending` covers all.
- Is the D2 secret list enough? Default: yes for now; more patterns get added when a real leak is found in the log.
- Should `false-positive` marks also feed the mistake-capture tooling? Default: no; `--false-positives` is the review input.
