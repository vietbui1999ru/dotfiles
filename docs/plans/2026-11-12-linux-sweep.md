# Linux sweep: macOS-only constructs in agent scripts

Sweep: `rg -uu -n 'stat -f|date -v|sed -i|readlink|security |/Users/|Library/|launchctl|pbcopy|pbpaste|osascript|sandbox-exec|F_GETPATH|/opt/homebrew' scripts shared claude/.claude/hooks`

98 raw hits. Skipped: `node_modules`, test fixtures that use a path only as sample
data, and docs. "Predicted" means reasoned from the code, not run on Linux. Nothing was
run on Linux.

## Triage

| file:line | construct | Linux behaviour (predicted unless noted) | verdict |
|---|---|---|---|
| scripts/pi-dispatch:133 | `stat -f %z` | BSD-only; GNU `stat -f` exits 0 with filesystem text. Wrong size check. | already handled (other branch; do not edit) |
| scripts/pi-dispatch:164 | `stat -f %Lp` | same as above | already handled |
| scripts/pi-dispatch:176 | `fcntl.F_GETPATH` | Linux has no F_GETPATH; python raises | already handled |
| scripts/secret-get:33-34 | `stat -f %Lp` | same as above | already handled |
| scripts/bootstrap-dirs.sh:19 | `$HOME/Library/Application Support/pueue` | path absent on Linux; the `for` loop skips it (`-d` test) and the `.local/share/pueue` entry is used | already handled (loop is already portable; no change) |
| scripts/pane-handoff:78,84 | `/Users/...` example path; `/opt/homebrew/bin` in an error message | message only; advice is macOS-specific | already handled |
| shared/skills/delegate-pi/SKILL.md (`/Users/...`, pi-dispatch) | docs path | docs | already handled (do not edit) |
| scripts/sync-status, claude/.claude/statusline-command.sh | not in the sweep output; listed as already handled by the brief | — | already handled (not verified here) |
| scripts/pi-sandbox | `sandbox-exec` | refuses on Linux (no sandbox-exec) by design | Mac-only by design |
| scripts/pi-sandbox.sb | Seatbelt profile | macOS-only file | Mac-only by design |
| scripts/pi-sandbox-policy:15 | `Library/Application Support/pueue` socket dir | policy data; Linux equivalent is `.local/share` | Mac-only by design |
| scripts/pi-sandbox-policy.test.mjs:38 | Library path in fixture | test sample data | Mac-only by design |
| scripts/herdr-sketchybar-bridge:1,21-22 | `/opt/homebrew` node, sketchybar, pueue | sketchybar is macOS | Mac-only by design |
| scripts/headroom-doctor:30 | `launchctl print` | fails on Linux; the check reports "not running" | Mac-only by design |
| scripts/setup-fonts.sh:22-52 | `/Library/Fonts`, `~/Library/Fonts` | font install; a Linux font dir is missing | defer (install-time, not an agent path) |
| scripts/agent-review:277 | `/usr/bin/osascript` notification | macOS-only; on Linux the notify call fails | defer (notification only) |
| scripts/herdr-copy:15 | `pbcopy` | "command not found" on Linux | defer (clipboard, no portable form in scope) |
| scripts/sync-agents:233 | `os.readlink` | portable (Python, not the BSD tool) | already handled (no change needed) |
| scripts/hooks/reference-transaction:56 | `readlink -f` | GNU and BSD 13+ both support it | already handled (no change needed) |
| scripts/hooks/pre-commit:9 | `readlink` (no -f) | portable | already handled (no change needed) |
| claude/.claude/hooks/enforce-bash-safety.sh:22 | `readlink` loop | portable for symlink targets | already handled (no change needed) |
| claude/.claude/hooks/lint-autofix.sh:30 | `date -u +...` | portable (no `-v`) | already handled (no change needed) |
| scripts/jw, scripts/focus, scripts/commit-funnel, scripts/spec, scripts/floor-guard, scripts/provenance* | no matches on the sweep patterns | — | already handled (clean) |
| scripts/pi-view, pi-wait, pi-steer, pi-pane-run, pueue-safe, with-secrets | no matches on the sweep patterns | — | already handled (clean) |
| test fixtures (`/Users/someone`, `/Users/vietquocbui` in tests) | sample path data | not executed on Linux as macOS paths | Mac-only by design (fixture, not a construct) |

## Files changed

None to scripts. Every in-scope hit is either already portable or outside the fix list
(see the triage). The only file this run adds is this report. Scripts were not edited, so
no script commit is needed.

## Test commands

- `scripts/tests/test_pueue_safe.py` and `scripts/tests/test_with_secrets.py` exist for
  the Pi dispatch scripts; no test covers `bootstrap-dirs.sh`. No test was added (no
  scaffolding), so no test command was run for that file.

## Defer items

- `scripts/setup-fonts.sh` — install-time font directories; not an agent path.
- `scripts/agent-review` (osascript) — macOS notification only; no portable equivalent in scope.
- `scripts/herdr-copy` (pbcopy) — clipboard; a portable form (xclip/wl-copy) would touch
  behaviour outside this sweep.
