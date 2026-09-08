# GitHub stacked pull requests

Use GitHub's [`gh-stack`](https://github.com/github/gh-stack) extension when a
single feature benefits from ordered, dependent review layers. Do not use one
stack for unrelated fixes; create separate branches or stacks instead.

## Preconditions

- GitHub CLI 2.90+ and Git 2.20+; authenticate with `gh auth login`.
- Install the extension: `gh extension install github/gh-stack`.
- Run `./scripts/bootstrap-dirs.sh` to sync the `gh-stack` agent skill to
  `~/.agents/skills/gh-stack`.
- Start from a clean, current trunk. Do not initialize a stack from the shared
  dirty working tree.
- `git rerere.enabled=true` and `remote.pushDefault=origin` are tracked in
  `git/.gitconfig` to avoid prompts during stack operations.

## Layering and review

Plan the dependency order before writing code. Put shared primitives and lower
level behavior in bottom branches; place consumers, integration, and UI in
higher branches. Each branch must stay independently reviewable.

The existing workflow remains in force for every layer:

1. Create or update the AgentOps plan.
2. Make the layer's changes in an isolated worktree or branch.
3. Run focused validation and create a review-gate batch.
4. Obtain approval, then stage and commit only that layer's files.
5. Create the next dependent branch only after the current layer is committed.

Do not use `gh stack add -A` as the default: deliberate `git add <paths>` keeps
layer boundaries intact.

## Agent-safe commands

`gh-stack` presents interactive prompts or a TUI for some defaults. Agents must
use these non-interactive forms:

```sh
# Start with an explicit first branch; never use bare `gh stack init`.
gh stack init feature/foundation

# After committing the reviewed bottom layer, create the next layer.
gh stack add feature/integration

# Publish draft PRs, creating titles without prompts.
gh stack submit --auto

# Inspect structured state; plain `gh stack view` opens a TUI.
gh stack view --json

# Routine remote reconciliation.
gh stack sync --remote origin
```

Add `--prune` to `sync` only with explicit approval: it deletes local branches
whose PRs are merged. `submit --auto --open` is similarly an explicit decision
to mark PRs ready for review rather than drafts.

## Mid-stack changes and recovery

When a higher layer needs a lower-layer change, switch to the correct lower
branch, commit the change there, then rebase the dependent branches:

```sh
gh stack checkout feature/foundation
git add <paths>
git commit -m "Adjust foundation"
gh stack rebase --upstack
```

On conflict, resolve and stage each file, then run `gh stack rebase --continue`.
Use `gh stack rebase --abort` to restore the pre-rebase state if resolution is
unsafe. If local and remote stack definitions diverge, `gh stack sync` aborts in
non-interactive mode; inspect with `gh stack view --json`, then explicitly run
`gh stack unstack --local` and rebuild local tracking if needed. Do not run bare
`gh stack unstack`: it also removes the GitHub stack grouping.

## Publishing and merging

Use `gh stack submit --auto` only after all layer commits have passed the review
gate. Create a `/pr` AgentOps note containing the stack order and PR URLs. Do
not merge a stack without user approval; merge explicitly with:

```sh
gh stack merge --yes
```

`gh stack merge` processes the stack bottom-to-top. If a repository does not
enable GitHub Stacked PRs, `submit` exits with code 9 in non-interactive mode;
report that limitation rather than falling back to unstacked PRs silently.
