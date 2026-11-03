---
status: draft
branch: feat/auto-miner
---
# SPEC: Automation miner files ranked automation candidates for triage

## Objective
Find repeated work in Claude transcripts, Claude prompt history, Pi sessions and zsh history. Rank each finding on the automation ladder: mechanical script > Pi dispatch > Claude > human. Each week, file the top few as GitHub issues with a drafted plan in the private `vietbui1999ru/agent-events` repo, for a human to triage.

Success:
- A weekly launchd run files at most 3 automation issues and 1 lean issue.
- Each issue carries redacted evidence and a plan.
- A candidate never comes back once its issue is closed with the `rejected` label.

## Acceptance Criteria
- AC-1: A Bash command sequence repeated at least 3 times across at least 2 Claude sessions within 28 days (fixture transcripts) becomes a candidate with proposed tier `script`.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k bash_sequence`
- AC-2: A prompt typed at least 3 times across at least 2 sessions in `~/.claude/history.jsonl` becomes a candidate. It is matched after normalization: paths, numbers and quoted text collapse to placeholders.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k prompt_shape`
- AC-3: A repeated prompt shape where Claude answered only with Edit/Write calls on at most 3 files becomes a candidate with current tier `claude` and proposed tier `pi`.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k claude_bounded_edit`
- AC-4: Pi sessions whose first user message has the same normalized shape at least 3 times become a candidate with current tier `pi` and proposed tier `script`.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k pi_dispatch`
- AC-5: A shell command sequence repeated in `~/.zsh_history` becomes a candidate with current tier `human` and proposed tier `script`. History lines in both the plain format and the EXTENDED_HISTORY format (`: <epoch>:<dur>;cmd`) parse.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k zsh_history`
- AC-6: Candidates below the threshold are kept in a state file with their evidence counts and are not filed. The threshold is at least 3 occurrences across at least 2 sessions within 28 days. They qualify on a later run once enough evidence builds up.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k threshold_and_state`
- AC-7: Nothing sent to Pi or to GitHub contains `$HOME` paths, secret-shaped tokens or literals longer than 200 characters. Secret shapes include `sk-...`, `ghp_...`, `AKIA...` and `KEY=value` pairs whose names contain KEY, TOKEN or SECRET. Long literals are truncated.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k redaction`
- AC-8: Candidates are ranked by frequency × estimated minutes saved × tier jump. One run files at most 3 automation issues.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k ranking_and_cap`
- AC-9: Each issue carries a hidden `<!-- fp:<fingerprint> -->` marker. A fingerprint is not filed again while an issue with it is open, or after one was closed with the `rejected` label. The test stubs gh.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k suppression`
- AC-10: Each issue body holds a plan drafted by Pi (stubbed in the test) with the sections Purpose, Evidence, Current tier → proposed tier, Proposed script or dispatch, Effort and Risks. If Pi fails, the issue is filed with the template sections and a note that drafting failed.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k plan_drafting`
- AC-11: The lean detector reads `skill-vendor audit --json` (stubbed) and files at most 1 `lean` issue per run, outside the automation cap.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k lean_detector`
- AC-12: `--dry-run` prints the ranked candidates and makes no gh or pi call.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k dry_run`
- AC-13: Issues go to `vietbui1999ru/agent-events` with the labels `automation-candidate` or `lean`, plus `tier:<proposed>` and `repo:<target>`. Labels are created idempotently with `gh label create --force` before filing.
  verify: `python3 -m unittest -v scripts/tests/test_automation_miner.py -k labels_and_repo`
- AC-14: A launchd agent runs the miner weekly, on Sunday at 19:00.
  verify: `plutil -lint launchd/Library/LaunchAgents/com.vietbui.automation-miner.plist && plutil -extract StartCalendarInterval.Weekday raw launchd/Library/LaunchAgents/com.vietbui.automation-miner.plist | rg -qx 0`
- AC-15: On real data, `scripts/automation-miner --dry-run` lists sensible candidates with redacted evidence.
  verify: manual - judging candidate quality needs a human

## Boundaries
### Always
- Python 3 standard library only. Every external command (gh, pi, skill-vendor) can be overridden by an env var so tests can stub it, as `scripts/skill-vendor` and `scripts/pi-queue` do.
- Read sources only. The miner never edits transcripts, history, skills or plugins.
- Run `~/dotfiles/scripts/spec check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done.
### Ask first
- Filing to any repo other than `vietbui1999ru/agent-events`.
- Any LLM other than the cheap Pi drafter (`opencode-go/deepseek-v4.1-flash`).
### Never
- Send raw transcript text, unredacted paths or secrets off the machine.
- Edit a `verify:` line or a test to make a check pass.

## Open Questions
- Language. Default: Python, matching `trial-usage.sh` and `skill-vendor` (the plan said node).
- Minutes saved per detector. Default: fixed constants per detector (bash sequence 2, prompt shape 3, bounded edit 5, Pi dispatch 3, zsh sequence 1), tuned after the first real run.
- `repo:<target>` label. Default: the cwd or project recorded with the evidence, reduced to the repository's folder name. Use `repo:unknown` when there is none.
- State file. Default: `~/.claude/state/automation-candidates.json`.
- Who builds it. Default: Pi on the high tier (`opencode-go/claude-haiku-5-5:off`) from a plan doc. Claude reviews.
