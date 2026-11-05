# Working on dotfiles from more than one machine

Dotfiles are edited from the Mac and the Proxmox (Linux) machine at the same time, often by
agents on both. The rules below keep that from producing duplicate or contradicting work.
GitHub `main` is the single source of truth; a branch one machine cannot see does not exist
for the other.

## The eight rules

1. **Open a draft PR as soon as a branch is pushed.** The open PR list is the one view both
   machines and their agents share. A pushed branch with no PR is invisible work.
2. **Fetch at the start of every session; never merge, rebase or pull automatically.**
   `git fetch --prune` is always safe. Moving a checkout that an agent is editing is how
   surprise conflicts start, so integrating stays a deliberate step.
3. **Check for overlap before starting work.** `scripts/sync-status` prints how far the
   branch is behind `origin/main` and, for every open PR, the files it shares with this
   branch. Claude runs it as a SessionStart hook (`startup`, `resume`, `clear`), so the
   report is in context from the first turn. A branch this one is stacked on is marked as
   such, not as an overlap.
4. **Keep PRs small and merge them quickly.** Conflicts grow with how long a branch lives.
   Stack dependent work (`docs/workflows/stacked-prs.md`) and merge from the bottom.
5. **Label every PR with the machine it came from:** `machine:mac` or `machine:pve`.
   Branch names are capped at 16 characters, so the label carries the origin, not the name.
6. **Keep machine-specific values out of shared files.** Put them in `~/.gitconfig.local`,
   `.claude/settings.local.json` or `mise.local.toml`, and spell paths with `~` or `$HOME`,
   never `/Users/<name>` or `/home/<name>`. A hard-coded home path is silently dead on the
   other machine: the macOS-only deny rules matched nothing on Linux until #246.
7. **Delete branches after they merge.** A squash merge leaves its branch behind looking
   unmerged. Turn on *Automatically delete head branches* in the repository settings
   (it needs an admin token or the web UI) and clear old merged branches by hand.
8. **Claim work before starting it.** Put the task on the `.agents/` board
   (`kanban-status` skill) or open the draft PR first, so an agent on the other machine
   does not start the same task.

## When sync-status reports an overlap

Look at the other PR before editing the shared file. If it lands first, rebase onto
`origin/main` after it merges; if both must change the same lines, agree the order and
say so in both PR descriptions. Rebasing and merging are the owner's call, not an agent's.
