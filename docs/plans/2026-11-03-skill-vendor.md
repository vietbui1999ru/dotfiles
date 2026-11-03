# Plan: scripts/skill-vendor (check + audit)

You are implementing two acceptance criteria of the approved spec `SPEC.md` at the repo root: **AC-7** and **AC-8**. Read SPEC.md first. Work only on the files listed here, and do not edit SPEC.md or any `verify:` line. Commit as you go through `$HOME/dotfiles/scripts/commit-funnel --worktree <this worktree> -F <msg file> <paths>`.

## Files you own

- `scripts/skill-vendor`: new executable, Python 3 standard library only, with shebang `#!/usr/bin/env python3`. Follow the style of `scripts/trial-usage.sh`'s embedded Python and `scripts/agent-session`.
- `scripts/tests/skill-vendor.test.sh`: new bash test that takes a case name, `check` or `audit`.
- `scripts/tests/fixtures/skill-vendor/`: new fixtures.

Do not touch anything else.

## Input: shared/skills/vendor.json

It already exists. Read it to learn the shape: `{"skills":[{"name","status"?, "upstream":{"repo","path","sha"},"notes"}]}`. The skills root is the directory that holds vendor.json.

## `skill-vendor check [--vendor PATH]`

- `--vendor` defaults to `shared/skills/vendor.json` next to the repo root (resolve it relative to the script: `<script dir>/../shared/skills/vendor.json`).
- The GitHub CLI is `$SKILL_VENDOR_GH`, or `gh` when that is unset. The tests stub it with a fixture script.
- For each entry whose `status` is not `frozen`:
  1. Run `<gh> api repos/<repo>/compare/<sha>...HEAD --jq '[.files[].filename]'`. The entry has **drifted** if `upstream.path` is in that list.
  2. If `<skills root>/<name>/upstream.md` exists and the entry drifted, fetch the current upstream file with `<gh> api repos/<repo>/contents/<path> --jq .content` (base64) and print a unified diff of upstream.md against it.
- For each entry, print one line: `<name>: in sync`, `<name>: drifted`, `<name>: frozen (skipped)` or `<name>: pin missing (<reason>)`.
- **Pin missing** means one of these:
  - vendor.json is missing or invalid (exit 2 immediately).
  - The entry lacks `upstream.repo`, `upstream.path` or `upstream.sha`.
  - `<skills root>/<name>/SKILL.md` does not exist.
- **Exit code:** 2 if any pin is missing, else 1 if any entry drifted, else 0.
- **gh failures:** if a `gh` call fails, print `<name>: error (<stderr first line>)` and treat it as exit 2. Never crash with a traceback.

## `skill-vendor audit --json [--home DIR] [--days N]`

- `--home` defaults to `$HOME`, and `--days` defaults to 60. Read only under `--home`.
- Print one JSON object:
  - `unused_skills`: list of `{"name", "last_used"}`, sorted by name.
    - Candidates are every entry name in `<home>/.claude/skills/` (files or symlinks, broken ones included) plus `<plugin>:<skill>` for every skill directory of every **enabled** plugin.
    - Enabled plugins come from `<home>/.claude/settings.json` → `enabledPlugins`. Install paths come from `<home>/.claude/plugins/installed_plugins.json` → `.plugins[key][0].installPath`, and the skills are under `<installPath>/skills/*/SKILL.md`.
    - Usage is a Skill tool_use in `<home>/.claude/projects/**/*.jsonl` whose `input.skill` equals the candidate name. Parse each line as JSON, take the line's `timestamp` (ISO 8601), and skip bad lines.
    - A skill is unused if it has no use within the last `--days` days. `last_used` is the latest ISO timestamp, or null.
  - `session_start_bytes`: `{ "<plugin key>": <int> }` for each enabled plugin.
    - Read `<installPath>/hooks/hooks.json` and, if present, `<installPath>/.claude-plugin/plugin.json` → `hooks`.
    - Take every `SessionStart` command hook and run it with `/bin/sh -c`. Set env `CLAUDE_PLUGIN_ROOT=<installPath>`, stdin `{"hook_event_name":"SessionStart","source":"startup"}` and a 10 s timeout.
    - Sum the stdout bytes. A timeout or failure counts as 0 and adds the plugin key to a top-level `"errors"` list.
  - `hooks`: `{ "<plugin key>": { "<event>": <number of hook commands> } }` for each enabled plugin, from the same hook sources.
- Without `--json`, print a short human table of the same data.

## Tests: `scripts/tests/skill-vendor.test.sh <check|audit>`

Use the same style as `claude/.claude/hooks/tests/precompact-save.test.sh`: a `fail()` helper, a `mktemp -d` dir and `trap` cleanup, and exit 0 printing `skill-vendor <case>: ok` on success.

- **`check`**: build a temporary skills root with a vendor.json, plus a stub gh script set through `SKILL_VENDOR_GH`. The stub answers by its arguments: the compare call returns a JSON list chosen by an env var, and the contents call returns base64 text. Assert:
  - In sync gives exit 0.
  - Upstream path in the compare list gives exit 1, with output containing `drifted` and a diff line starting with `+` or `-`.
  - A missing SKILL.md, or an entry without `sha`, gives exit 2.
  - A `frozen` entry is skipped and never calls gh. Make the stub fail loudly if it is called for that entry.
  - A failing gh gives exit 2 with no traceback.
- **`audit`**: build a fake home with:
  - `.claude/skills/{used-skill,old-skill}`;
  - `settings.json` enabling one fake plugin, plus `installed_plugins.json` pointing at a fixture plugin dir;
  - the fixture plugin with `skills/p-skill/SKILL.md` and a `hooks/hooks.json` that has one SessionStart command `printf 'hello'` and one PostToolUse hook;
  - a transcript jsonl with a Skill use of `used-skill` dated today, a use of `old-skill` dated 90 days ago, and one garbage line.

  Assert with `jq -e`:
  - `unused_skills` names are exactly `["fake:p-skill","old-skill"]` (adjust the prefix to your fixture's plugin name).
  - `old-skill.last_used` is not null.
  - `session_start_bytes[<key>] == 5`.
  - `hooks[<key>].SessionStart == 1` and `.PostToolUse == 1`.

## Done when

- `bash scripts/tests/skill-vendor.test.sh check` and `bash scripts/tests/skill-vendor.test.sh audit` both exit 0.
- `scripts/skill-vendor check` run for real exits 0 or 1 (not 2) against `shared/skills/vendor.json`. Report its output in your final message, but do not "fix" vendor.json to make it exit 0.
- Everything is committed through commit-funnel. Do not push.
