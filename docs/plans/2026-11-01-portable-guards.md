# Portable guards (multi-machine Phase 1)

Branch: `worktree-portgrd`. Parent plan: `~/.claude/plans/i-want-to-bring-tranquil-sunrise.md`, Phase 1.

## Goal

A fresh Linux box (WSL2, homelab, Raspberry Pi) that stows `claude`, `zsh` and `pi` from this repo starts a zsh shell and a Claude Code session with no errors, even before the optional tools are installed. Behaviour on the Mac must stay exactly the same.

## Boundaries

- Edit only `claude/.claude/settings.json`, `zsh/.zshenv`, `zsh/.zshrc`, and the new files under `pi/.pi/agent/`.
- Do not touch `codex/` (the main checkout has uncommitted work there), the NotchBar hook lines (already guarded), hook scripts themselves, or tests.
- Do not touch anything under `~/.pi` or `~/.claude`; the live link swap is a manual step after merge.
- Preserve each hook's exit code and stdout when the target exists. A guard only adds "exit 0 silently when the target is missing".

## Tasks

### 1. settings.json: remove the absolute `/Users/` path

`claude/.claude/settings.json:236` currently reads:

    "command": "bash '/Users/vietquocbui/.claude/hooks/herdr-agent-state.sh' session",

Replace every hook command that runs `herdr-agent-state.sh` (grep the file for every occurrence, not only line 236) with the guarded form, keeping each line's original argument:

    "command": "f=\"$HOME/.claude/hooks/herdr-agent-state.sh\"; [ -f \"$f\" ] || exit 0; bash \"$f\" session",

Before editing, read `scripts/bootstrap-dirs.sh` and check whether `herdr integration install` writes these hook lines into settings.json. If it does, say so in the commit message body: a herdr reinstall may restore the unguarded form.

### 2. settings.json: guard the mistake-alert hook

`claude/.claude/settings.json:294`:

    "command": "node ~/dotfiles/scripts/mistake-alert-hook.mjs"

becomes:

    "command": "f=\"$HOME/dotfiles/scripts/mistake-alert-hook.mjs\"; [ -f \"$f\" ] && command -v node >/dev/null || exit 0; node \"$f\""

Leave line 135 (llm-wiki publish) alone: its `|| true` already covers a missing repo.

### 3. zsh: guard tool inits

Wrap each line so it runs only when the tool or file exists:

| File:line | Now | Guard |
|---|---|---|
| `zsh/.zshenv:4` | `. "$HOME/.cargo/env"` | `[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"` |
| `zsh/.zshrc:30` | `eval "$(sheldon source)"` | `command -v sheldon >/dev/null && eval "$(sheldon source)"` |
| `zsh/.zshrc:54` | `eval "$(starship init zsh)"` | `command -v starship >/dev/null && eval "$(starship init zsh)"` |
| `zsh/.zshrc:116` | `[[ -o interactive ]] && eval "$(zoxide init zsh --cmd cd)"` | add `&& command -v zoxide >/dev/null` before the eval |
| `zsh/.zshrc:128` | `. "$HOME/.local/share/../bin/env"` | `[ -f "$HOME/.local/bin/env" ] && . "$HOME/.local/bin/env"` |

Scan the rest of `.zshrc` and `.zshenv` for other unconditional `eval "$(tool ...)"` or `source`/`.` of files that may not exist. Guard any you find in the same style, and list them in the commit body.

### 4. Pi: track the model-routing config

Copy `$HOME/.pi/agent/settings.json` and `$HOME/.pi/agent/routing.env` byte for byte into `pi/.pi/agent/settings.json` and `pi/.pi/agent/routing.env`. Both were checked and hold no keys or tokens; grep them again for `key|token|secret|password` (case-insensitive) and stop if anything matches. Do not copy `auth.json`, `mcp-auth.json` or anything else.

## Verification

Run each command and paste its output into the final report:

    jq empty claude/.claude/settings.json && echo settings-ok
    zsh -n zsh/.zshrc && zsh -n zsh/.zshenv && echo zsh-ok
    node --test scripts/mistake-alert-hook.test.mjs
    rg -n '/Users/' claude/.claude/settings.json | rg -v 'NotchBar' | rg -v '"(Read|Edit|Write|Bash)\(' || echo no-unguarded-users-paths
    env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin ZDOTDIR="$PWD/zsh" zsh -i -c 'echo clean-start' 2>&1 | tail -5

The last command simulates a bare machine. It must print `clean-start` with no "command not found" or "no such file" lines from the guarded inits. Report any remaining errors honestly instead of hiding them.

## Commits

One commit per task (four in total), staged by path through `$HOME/dotfiles/scripts/commit-funnel`. Messages in Conventional Commits form, e.g. `fix(claude): guard herdr-agent-state hook for non-Mac hosts`.
