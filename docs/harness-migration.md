# Migration to agent-harness

The agent workflow moves to `vietbui1999ru/agent-harness`. This file lists the dotfiles parts that still depend on the old pieces. It also gives the order in which they leave.

The old pieces are llm-wiki tooling, claude-tui, agent-events and the pueue dispatch chain. Each machine keeps working while it pulls these changes. No step in stage 1 removes a running part.

## Stage 1: notices only (this change)

- agent-events: retired. No dotfiles part reads or writes it.
- claude-tui: maintenance only. The Mac keeps the daemon until the harness reports usage.
- llm-wiki: the knowledge content stays. `claude-setup/` and the agent scripts are frozen.

On each machine, do these steps:

1. Run `git pull` in `~/dotfiles`, `~/repos/llm-wiki`, `~/repos/claude-tui` and `~/repos/agent-events`.
2. Run `scripts/restow.sh` in `~/dotfiles`.
3. On a machine that stows dotfiles, do not run `llm-wiki/claude-setup/scripts/install-claude-symlink.sh`. Dotfiles owns `~/.claude`.

## Dependency map

| Dotfiles part | Depends on | Runs on a machine | If the dependency is absent |
|---|---|---|---|
| `sketchybar/.config/sketchybar/items/claude_usage.sh`, `plugins/claude_usage.sh` | claude-tui | Mac | shows "usage: daemon down" |
| `aerospace/.aerospace.toml` (`alt-u`) | claude-tui popup | Mac | the popup shows the same message |
| `herdr-app/.config/herdr-app/mods/ai-spend/main.js` | claude-tui | Mac | no spend data |
| `claude/.claude/statusline-command.sh` | writes `~/.local/state/claude-tui` | all | the snapshot has no reader |
| `claude/.claude/settings.json` PostToolUse hook | `~/repos/llm-wiki/scripts/publish-ai-kb.sh` | all | the hook ends with `true` |
| `claude/.claude/settings.json` permissions and sandbox paths | `~/repos/llm-wiki/claude-setup` | all | unused entries |
| `opencode/.config/opencode/opencode.json`, `plugins/workflow.js`, `plugins/cc-compat.js` | llm-wiki skills, hook and `mistakes/raw-log.md` | where OpenCode runs | not checked |
| `zsh/.zsh/functions.zsh` (`council`) | llm-wiki templates | all | the function fails |
| `scripts/bootstrap-dirs.sh`, `.gitmodules` | llm-wiki submodule and marketplace link | bootstrap only | not checked |
| `ansible/roles/agents/tasks/main.yml` | qmd and the wiki collection | Linux bootstrap | not checked |
| `scripts/cloud/send-it-setup.sh` | llm-wiki at a pinned SHA | cloud sessions | not checked |
| `session-band-plugin/hooks/send-it.ts` deny lists | `~/repos/agent-events`, llm-wiki `.git` | Claude mod | harmless entries |
| `scripts/pi-queue`, `pi-view`, `pi-outcome`, `pueue-safe`, `systemd/.config/systemd/user/pueued.service`, the herdr bridge plist | pueue | all | Pi dispatch stops |

## Stage 2: remove claude-tui parts (Mac)

Start this stage when the harness reports usage on the Mac.

1. Remove the sketchybar item, the aerospace binding, the `ai-spend` mod and the status line snapshot in one change.
2. Follow the removal order in the claude-tui README.

## Stage 3: remove llm-wiki tooling links

Start this stage when the harness serves the rules and skills (spec P1-10).

1. Remove the publish hook, the `claude-setup` paths, the OpenCode wiki links and the submodule.
2. Remove `claude-setup/` and the agent scripts from llm-wiki.

## Stage 4: remove the pueue chain

Start this stage when the harness supervisor dispatches Pi runs (specs P1-03 and P1-05).

1. Remove the `pi-*` scripts, `pueue-safe`, `pueued.service`, the herdr bridge and the session-band pueue hooks.

Each removal in stages 2 to 4 needs the owner's approval before it lands.
