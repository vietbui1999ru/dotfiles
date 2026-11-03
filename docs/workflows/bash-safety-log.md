# Bash-safety block log

The Bash `PreToolUse` hook (`claude/.claude/hooks/enforce-bash-safety.sh`) stops a
handful of irreversible commands. Every command it stops leaves a redacted,
traceable record, so the human side of the loop can see what the gate caught, judge
each catch, and turn a wrong catch into a rule change.

The log is for people. It never allows anything: the hook's decision, exit code and
stderr reason are the same whether or not the log can be written.

## Where the records live

```
${SAFETY_LOG_DIR:-$HOME/.claude/state}/
  bash-safety-blocks.jsonl      one JSON object per blocked command
  bash-safety-blocks.jsonl.1    the previous file, after rotation
  bash-safety-verdicts.jsonl    one {"id","verdict","ts"} per human verdict
```

- **Only refusals are logged.** An allowed command writes nothing. The writers are
  the Bash hook's blocks, the ref guard's refusals, pi-queue's worktree-busy refusals
  and the built-in worktree guard's refusals (see Writers below).
- **Rotation:** when the log passes 2000 entries the next block moves it to
  `bash-safety-blocks.jsonl.1` (replacing any older `.1`) and starts a new file.
  `safety-log` reads both.
- **Verdicts are a separate, append-only file,** so the hook and the CLI never
  rewrite the same file. The last verdict for an id wins.

## Fields

| Field | Meaning |
|---|---|
| `id` | 12 hex characters, unique per block; the handle `safety-log mark` takes |
| `ts` | local ISO 8601 time of the block, e.g. `2026-10-21T16:02:11+07:00` |
| `session` | the Claude Code session id that ran the command |
| `cwd` | the session's working directory, which names the worktree |
| `transcript` | the session's transcript path, for reading what led to the command |
| `rule` | a short stable id per check: `rm-rf-root-home`, `force-push-main`, `reset-hard-remote`, `git-clean-force`, `force-push-lease`, `push-plus-ref`, `push-delete-ref`, `worktree-commit`, `ref-guard`, `queue-worktree-busy`, `worktree-guard`, or `other` |
| `command` | the redacted command, in full up to the cap |
| `reason` | the first line of the block message, the same sentence the agent saw |

## Redaction

Secrets are replaced with `[REDACTED]` before anything is written:

- GitHub tokens: `ghp_`, `gho_`, `ghs_`, `github_pat_`
- `sk-` API keys
- `Bearer <token>`
- AWS access key ids (`AKIA…`)
- the value of any `NAME=value` assignment whose name contains `TOKEN`, `SECRET`,
  `PASSWORD`, `PASSWD` or `KEY`, including a `"double"` or `'single'` quoted value
- the value after `--token`, `--password`, `--passwd`, `--secret`, `--api-key` or
  `--apikey`, written with `=` or a space

Everything else is kept verbatim, because the command is what makes a block
traceable. A command longer than 4000 characters is cut there and ends with
`…[truncated]`.

If you find a secret in the log that the list above missed, treat it as a leak: fix
the pattern in the hook, then rotate the secret. Do not paste the log into an issue.

## Writers

The Bash hook keeps its own `jq` writer. Every other writer calls the shared
writer, `scripts/safety-log record`, best effort: a failed write never changes the
guard's decision, exit code or message.

```sh
safety-log record --rule ref-guard --reason TEXT [--command C] [--session S] [--cwd D] [--transcript T] [--noted]
```

`record` redacts, caps and rotates exactly as the hook does, and prints the new id.
`--noted` also writes a `noted` verdict for the entry.

- **`ref-guard`:** the `reference-transaction` hook, when it refuses a move of an
  existing branch in an agent worktree. The command is the parent git command line.
- **`queue-worktree-busy`:** pi-queue, when a pi step's worktree already runs another
  pueue task. Its `failed` event carries the same reason.
- **`worktree-guard`:** the `PostToolUseFailure` hook
  (`claude/.claude/hooks/log-worktree-guard.sh`), for Claude Code's built-in worktree
  guard. It writes a `noted` verdict, because the built-in guard was already decisive.

`noted` is written only by the logger. A human's `safety-log mark` overrides it. The
pending count (the chip and `safety-log --pending`) skips `noted`, and
`--false-positives` counts only `false-positive`. `safety-log mark` still accepts only
`ok` and `false-positive`.

## Built-in guard probe

Probed 2026-11-03 on Claude Code 2.1.317, in a worktree-isolated session. The built-in
worktree guard's Bash refusals fire **`PostToolUseFailure`**. The payload carries
`tool_name`, `tool_input.command`, `error` (the refusal text), `session_id`, `cwd`,
`is_interrupt` and `transcript_path`. Every refusal's text contains
`is isolated in the worktree` and `Refusing to run it`; an ordinary failure such as
`false` gives `Exit code 1`, which the hook does not log. `PermissionDenied` did not
need registering and is not registered.

## `safety-log`

`scripts/safety-log` is Python 3, standard library only, and reads the directory
above (`SAFETY_LOG_DIR` overrides it). The scripts are not on `PATH`, so run
`~/dotfiles/scripts/safety-log`.

```sh
safety-log                        # newest first, one line each
safety-log --session 11112222     # this session (full id or its first 8 characters)
safety-log --rule git-clean-force # one rule
safety-log --since 2h             # 30m, 2h, 3d, 2w, or an ISO date
safety-log --pending              # no verdict yet, across every session
safety-log --json                 # the filtered entries as one JSON array
safety-log show 12ab34cd56ef      # one entry in full: reason, cwd, transcript
safety-log mark 12ab34cd56ef ok
safety-log mark 12ab34cd56ef false-positive
safety-log --false-positives      # false-positive counts per rule
```

Each list line is the time, the session id shortened to 8 characters, the rule, the
verdict or `pending`, then the redacted command. Filters combine, so
`--rule git-clean-force --pending` is "that rule still waiting for a judgement".

`safety-log mark` appends `{"id","verdict","ts"}` to the verdicts file. An unknown
id exits 2 and writes nothing. Marking again appends another line; the last one
wins, so a mis-click is fixed by marking the other way. `--false-positives` is the
review input: a rule that keeps coming up there is a rule that needs narrowing.

## The band: the chip and the Blocks pane

The session-band shows `⛔N` only when this session has N blocks with no verdict.
The count is this session's; `safety-log --pending` covers every session.

Pressing the chip (or `/blocks`) opens the **Blocks** pane, listing this session's
blocks newest first with time, rule, verdict and command.

| Key | Action |
|---|---|
| `j` / `k` | next / previous block |
| `o` | `safety-log mark <id> ok` — the block was the right call |
| `f` | `safety-log mark <id> false-positive` — the block was wrong |
| `r` | reload the list |
| `q` | close the pane |

`o` and `f` run the CLI and then refresh, so the row shows its verdict and the chip
count drops. Nothing in the pane changes what the hook does.

## The verdict loop

1. An agent's command is blocked; it learns why from stderr, and the block lands in
   the log.
2. A human traces it with `safety-log` or the Blocks pane.
3. `ok` means the gate worked. `false-positive` means it stopped something safe.
4. `safety-log --false-positives` turns those marks into a per-rule count. When a
   count says the rule is too broad, a human narrows the pattern in
   `enforce-bash-safety.sh` and reviews that change like any other.

A verdict only records a judgement. **Nothing ever auto-allows a blocked command**
from a verdict, and log data never leaves the machine.

## Testing the log

Pipe a fake hook payload into the hook with `SAFETY_LOG_DIR` pointing at a temporary
directory. Never test by running a blocked command in your shell: the hook only
guards the agent's Bash tool, so the command really runs and nothing is logged.

```sh
dir=$(mktemp -d)
echo '{"tool_input":{"command":"git clean -fd"},"session_id":"test","cwd":"/tmp"}' |
  SAFETY_LOG_DIR=$dir bash ~/dotfiles/claude/.claude/hooks/enforce-bash-safety.sh
echo "exit $?"                                   # 2, and one entry in $dir
SAFETY_LOG_DIR=$dir ~/dotfiles/scripts/safety-log
python3 -m unittest scripts.tests.test_safety_log
```

Tests never read or write the real `~/.claude/state`.

## Known limits

Both were reviewed and accepted as low impact:

- **The band re-reads the log on each draw.** The chip and pane read both block
  files and the verdicts file every time the band draws. The files are capped at
  2000 lines each, so this stays cheap; caching would add invalidation for little gain.
- **Rotation can race.** Two blocks landing at the same moment when the log is at
  2000 entries can both rotate, and the second move can replace the full `.1` with
  the one-line new file, dropping the older entries. This needs two blocks within
  milliseconds at the rotation point, and loses only history, never a decision.
