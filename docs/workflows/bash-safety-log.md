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

- **Only blocked commands are logged.** An allowed command writes nothing.
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
| `rule` | a short stable id per check: `rm-rf-root-home`, `force-push-main`, `reset-hard-remote`, `git-clean-force`, `force-push-lease`, `push-plus-ref`, `push-delete-ref`, `worktree-commit`, or `other` |
| `command` | the redacted command, in full up to the cap |
| `reason` | the first line of the block message, the same sentence the agent saw |

## Redaction

Secrets are replaced with `[REDACTED]` before anything is written:

- GitHub tokens: `ghp_`, `gho_`, `ghs_`, `github_pat_`
- `sk-` API keys
- `Bearer <token>`
- AWS access key ids (`AKIA…`)
- the value of any `NAME=value` assignment whose name contains `TOKEN`, `SECRET`,
  `PASSWORD`, `PASSWD` or `KEY`

Everything else is kept verbatim, because the command is what makes a block
traceable. A command longer than 4000 characters is cut there and ends with
`…[truncated]`.

If you find a secret in the log that the list above missed, treat it as a leak: fix
the pattern in the hook, then rotate the secret. Do not paste the log into an issue.

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

Point `SAFETY_LOG_DIR` at a temporary directory:

```sh
SAFETY_LOG_DIR=$(mktemp -d) git clean -fd   # one block, logged there
SAFETY_LOG_DIR=<that dir> ~/dotfiles/scripts/safety-log
python3 -m unittest scripts.tests.test_safety_log
```

Tests never read or write the real `~/.claude/state`.
