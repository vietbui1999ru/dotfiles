# Plan: scripts/automation-miner

You are implementing the approved spec `SPEC.md` at the repo root: AC-1 to AC-14. AC-15 is manual. Read SPEC.md first, including its Boundaries and Open Questions; the defaults there are decisions.

Do not edit SPEC.md or any `verify:` line. Commit as you go through `$HOME/dotfiles/scripts/commit-funnel --worktree <this worktree> -F <msg file> <paths>`. Do not push.

## Files you own

- `scripts/automation-miner`: new executable, `#!/usr/bin/env python3`, standard library only. Style follows `scripts/skill-vendor`, which you can read: argparse subcommands, every external command overridable by an env var, and no tracebacks on expected failures.
- `scripts/tests/test_automation_miner.py`: new `unittest` module. Each AC's tests must be selectable with `-k <name>`, so name the test methods `test_bash_sequence_*`, `test_prompt_shape_*`, `test_claude_bounded_edit_*`, `test_pi_dispatch_*`, `test_zsh_history_*`, `test_threshold_and_state_*`, `test_redaction_*`, `test_ranking_and_cap_*`, `test_suppression_*`, `test_plan_drafting_*`, `test_lean_detector_*`, `test_dry_run_*` and `test_labels_and_repo_*`. Load the script with `importlib.machinery.SourceFileLoader`, since it has no `.py` suffix. Build fixtures in `tempfile` dirs inside the tests; do not read the real home.
- `launchd/Library/LaunchAgents/com.vietbui.automation-miner.plist`: new.

## CLI

```
automation-miner [--home DIR] [--dry-run] [--state PATH]
```

- `--home` defaults to `$HOME`, and every source path is resolved under it.
- `--state` defaults to `<home>/.claude/state/automation-candidates.json`.

**Env overrides:**

| Variable | Default |
|---|---|
| `AUTOMATION_MINER_GH` | `gh` |
| `AUTOMATION_MINER_PI` | `pi` |
| `AUTOMATION_MINER_SKILL_VENDOR` | `<script dir>/skill-vendor` |
| `AUTOMATION_MINER_NOW` | current time (ISO 8601, for tests) |

## Sources and real formats (verified on this machine)

- **Claude transcripts:** `<home>/.claude/projects/*/*.jsonl`, one JSON object per line. Skip lines that don't parse.
  - Every entry has `sessionId`, `cwd` and `timestamp` (ISO).
  - Assistant entries have `message.content`: a list of parts. A tool call is `{"type":"tool_use","name":"Bash","input":{"command":...}}` or `{"name":"Edit","input":{"file_path":...}}` (also `Write`).
  - User prompts are entries with `type == "user"` whose `message.content` is a string.
- **Prompt history:** `<home>/.claude/history.jsonl`, with keys `display` (the prompt), `pastedContents`, `project` (cwd) and `timestamp` (epoch milliseconds). There is no session id, so treat `(project, calendar day)` as the session.
- **Pi sessions:** `<home>/.pi/agent/sessions/*/*.jsonl`.
  - The first line is `{"type":"session","cwd":...,"timestamp":...}`.
  - Messages are `{"type":"message","message":{"role":"user"|"assistant"|"system","content":[{"type":"text","text":...}]}}`.
  - The first `role == "user"` text is the dispatch prompt. The file is the session.
- **zsh history:** `<home>/.zsh_history`. Each line is either plain (`git status`) or EXTENDED_HISTORY (`: 1730000000:0;git status`).
  - A trailing `\` continues the command on the next line.
  - Plain lines have no time, so give them the time of the next timestamped line, or `now` if there is none.
  - A session is a run of commands with gaps under 30 minutes. Plain-only history is one session.

## Detectors

Each detector yields events of the form `(fingerprint, session_key, timestamp, project, evidence_text)`.

- **bash_sequence (AC-1):** windows of 3 consecutive Bash commands within one Claude session. Normalize each command: collapse whitespace, replace `$HOME`/absolute paths with `<path>`, numbers with `<n>` and quoted strings with `<str>`. The fingerprint is the sha1 of the joined normalized window. Tier: `claude → script`.
- **prompt_shape (AC-2):** normalized `display` from history.jsonl. Lowercase it, apply the same placeholders, and drop text past 200 chars. Tier: `human → script` when the prompt is a slash command (starts with `/`), otherwise `human → claude`.
- **claude_bounded_edit (AC-3):** a Claude user prompt (string content) whose following assistant tool calls, up to the next user prompt, are only Edit/Write on at most 3 distinct files. The fingerprint is the normalized prompt shape plus the sorted file basenames. Tier: `claude → pi`.
- **pi_dispatch (AC-4):** the normalized first user text of each Pi session, first 300 chars. Tier: `pi → script`.
- **zsh_history (AC-5):** windows of 3 consecutive commands within one zsh session, normalized as in bash_sequence. Tier: `human → script`.
- **lean (AC-11):** run `<skill-vendor> audit --json --home <home>`. Each `unused_skills` entry becomes a lean candidate with fingerprint `lean:skill:<name>`, and each plugin with `session_start_bytes > 1000` becomes `lean:startup:<plugin>`. Lean candidates skip the occurrence threshold. They are ranked by bytes (startup) and then by name. Per run, at most 1 lean issue is filed, separate from the cap of 3. If skill-vendor fails, warn on stderr and continue.

## Threshold, state and ranking (AC-6, AC-8)

- **Qualification:** a candidate qualifies when, within 28 days of now, it has at least 3 events across at least 2 distinct session keys.
- **State file:** every candidate seen goes into the state file, `{fingerprint: {detector, tiers, count, sessions, first_seen, last_seen, evidence: [up to 5 redacted samples], filed_issue}}`, which is merged with what was stored before. Candidates that don't qualify stay there and are not filed.
- **Minutes saved per occurrence:**

  | Detector | Minutes |
  |---|---|
  | bash_sequence | 2 |
  | prompt_shape | 3 |
  | claude_bounded_edit | 5 |
  | pi_dispatch | 3 |
  | zsh_history | 1 |

- **Tier jump:** with the rank order human=0, claude=1, pi=2, script=3, the jump is `rank(proposed) - rank(current)`, with a minimum of 1.
- **Score:** `count_in_window * minutes * jump`. File the top 3 qualifying candidates that suppression doesn't block.

## Redaction (AC-7)

Apply one `redact(text)` function to everything sent to pi or gh:

- Replace the home path with `~`, and other `/Users/<name>` or `/home/<name>` paths too.
- Replace `sk-[A-Za-z0-9_-]{16,}`, `ghp_[A-Za-z0-9]{20,}`, `github_pat_[A-Za-z0-9_]{20,}`, `AKIA[0-9A-Z]{16}` and `xox[bp]-[A-Za-z0-9-]+` with `<secret>`.
- In `NAME=value` pairs whose NAME contains KEY, TOKEN, SECRET or PASSWORD (case-insensitive), replace the value with `<secret>`.
- Cut any token longer than 200 characters to its first 40 plus `…<truncated>`.

## Suppression and filing (AC-9, AC-10, AC-13)

1. **Labels:** before filing, ensure these labels exist on `vietbui1999ru/agent-events`: `automation-candidate`, `lean`, `rejected`, and `tier:script`, `tier:pi` and `tier:claude`, each with `<gh> label create <name> --force -R <repo> --color <hex>`. Create the `repo:<target>` label for each issue the same way.
2. **Read existing markers:** `<gh> issue list -R <repo> --state all --label automation-candidate --label lean --limit 500 --json number,state,labels,body`. Note that gh ANDs repeated `--label` flags, so make one call per label and merge the results. Extract `<!-- fp:([0-9a-f:]+|lean:[^ ]+) -->`. Skip a fingerprint if any issue with it is OPEN, or CLOSED with the `rejected` label.
3. **Plan text:** for each candidate to file, call `<pi> -p "<prompt>" --model opencode-go/deepseek-v4.1-flash --no-session`, with a 120 s timeout.
   - The prompt asks for a plan with exactly the markdown headings `## Purpose`, `## Evidence`, `## Current tier → proposed tier`, `## Proposed script or dispatch`, `## Effort` and `## Risks`, built from the redacted evidence.
   - If pi fails, times out, or its output is missing any heading, use a template body with those headings filled from the data, plus the line `> Plan drafting failed: <reason>`.
4. **Create the issue:** `<gh> issue create -R vietbui1999ru/agent-events --title "<detector>: <short redacted shape>" --body-file <tmp> --label automation-candidate|lean --label tier:<proposed> --label repo:<target>`.
   - The body ends with `<!-- fp:<fingerprint> -->`.
   - `repo:<target>` is the basename of the evidence's cwd or project, or `unknown`.
   - Record the issue URL in the state file under `filed_issue`.

**`--dry-run` (AC-12):** print the ranked table (score, detector, tiers, count, sessions and the redacted shape) plus the lean pick. Run no gh, pi or skill-vendor command beyond reading the sources. Skipping the lean detector entirely in dry-run is acceptable, as long as the output says so. Do not write the state file either.

## launchd (AC-14)

- `Label`: `com.vietbui.automation-miner`.
- `ProgramArguments`: `["/bin/zsh", "-lc", "$HOME/dotfiles/scripts/automation-miner"]`.
- `StartCalendarInterval`: `{Weekday: 0, Hour: 19, Minute: 0}`.
- `StandardOutPath` and `StandardErrorPath`: `/tmp/automation-miner.log`.
- `RunAtLoad`: false.

It must pass `plutil -lint`. Use `scripts/../launchd/Library/LaunchAgents/com.vietbui.herdr-sketchybar-bridge.plist` as the format reference.

## Done when

- `python3 -m unittest -v scripts/tests/test_automation_miner.py` passes, and each `-k` selector in SPEC.md AC-1 to AC-13 matches at least one passing test.
- The plutil check from AC-14 passes.
- `scripts/automation-miner --dry-run` runs on this machine's real home without a traceback. Put its first 15 lines in your final message, redacted.
- Everything is committed through commit-funnel. Do not push.
