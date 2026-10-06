# session-band phase 2: blast-radius check for Bash

Date: 2026-10-06. Audience: Pi, building cold. Spec: `docs/superpowers/specs/2026-10-06-session-band-mod-design.md` (read "Blast radius" and "Risks and unknowns"). Phase 1 is merged (PR #44): the plugin lives in `session-band-plugin/` and loads through `CLAUDE_CODE_PLUGIN_DIRS`. Read `session-band-plugin/hooks/register.tsx` first for house style.

## Goal

Add a `tool.call` hook on Bash that sorts each command into three tiers, then retire `claude/.claude/hooks/enforce-bash-safety.sh` once the new check is proven live.

1. **Pass:** read-only or clearly scoped commands run untouched.
2. **Ask with preview:** the command pauses and the user answers through `$.ui.ask`, shown a preview. Never execute the command to build the preview.
3. **Hard deny:** unconditional, no question asked.

## Already established, do not re-derive

- **Old hook** (`enforce-bash-safety.sh`, 37 lines) denies three things: `rm -rf` aimed at `/`, `~` or `$HOME`; `git push` with `-f`/`--force` to `main`/`master`; `git reset --hard origin/...`. Its regex only sees `rm -rf` in that flag order, so `rm -fr /`, `rm -r -f ~` and `rm --recursive --force /` slip past it. The new deny tier must cover every old pattern **and** those forms. Treat the old hook as a floor, not a spec to copy.
- **`$.ui.ask(question, options)`** shows the engine's own dialog and resolves to the chosen label. It **rejects** when dismissed and in a `-p` run (nobody to ask). A rejection means deny. Compare the answer to your labels exactly; "Other" returns free text.
- **`$` cannot cross an import.** The validator refuses `$` passed to an imported function. So: pure logic (tokenising, classifying, formatting a preview from facts) lives in plain `.ts` files; every `$.process`, `$.fs` and `$.ui` call stays in the module file. Phase 1 hit this: see `git.ts` (pure) versus `register.tsx` (calls).
- **No shell parser exists in the engine** and the module has no Node. Write a small tokenizer yourself (below).
- **The guard shape** the engine wants: `on('tool.call', { tool: 'Bash' }, hook).catch(($, e, next) => next.called ? next(e) : { deny: '...' })`. Without `.catch` a throwing guard fails open. See the Agent guard in `register.tsx`.
- **Another hook may rewrite the command first.** The rtk PreToolUse hook turns `git status` into `rtk git status`, and `rg ...` into `rtk rg ...`. Your classifier must strip launchers before judging: `rtk`, `rtk proxy`, `command`, `builtin`, `env VAR=x`, `sudo`, `time`, `nohup`, `exec`, `xargs`, and absolute paths such as `/bin/rm` or `/usr/bin/git`. Unit-test each.
- `session.start` input carries `isInteractive`. Capture it there. If it is false, the ask tier denies without asking.
- **Harness quirk (affects you, the implementer's own shell):** in a worktree-isolated Claude session any Bash command whose text contains `git` is refused; run git as `/usr/bin/git`. This does not apply to `$.process.run` inside the plugin.

## Decisions (do not reopen)

1. **Files.** `hooks/classify.ts` (pure: tokenize, classify, normalize), `hooks/preview.ts` (pure: turn facts into preview text), `hooks/blast.tsx` (`register`: the hook, `$.process`/`$.fs`/`$.ui` calls). Add `./blast.tsx` to `hooks/hooks.json` `modules` beside `./register.tsx`. Keep both registrations independent.
2. **Tokenizer.** Split on unquoted `;`, `&&`, `||`, `|`, `&` and newlines. Honour single quotes, double quotes and backslash escapes. Classify each segment; the command's tier is the strictest segment's. Redirections `>` and `>>` onto an existing file are an overwrite: ask. `>/dev/null` and `2>&1` are not.
3. **Can't-analyze rule.** Any `eval`, `$(...)`, backticks, a pipe into `sh`/`bash`/`zsh`, `bash -c`/`sh -c` with a non-literal body, a here-doc feeding a shell, or an unterminated quote lands in **ask**, labelled "can't analyze". The parse failure itself never throws.
4. **Ask list** (from the spec): `rm`, `mv` over an existing destination, `git reset --hard` (any ref except the deny pattern), `git clean`, `find ... -delete`, `chmod -R`, overwriting redirects, `docker` and `kubectl` deletes (`rm`, `rmi`, `prune`, `delete`, `kill`). Also `git checkout .`, `git restore .` and `git stash drop`/`clear`: they discard work the same way.
5. **Deny list:** every old pattern plus the flag-order variants above; `rm` of `/`, `~`, `$HOME`, `/*`, or a top-level system directory (`/usr`, `/etc`, `/bin`, `/System`, `/Users`); `git push --force`/`-f`/`--force-with-lease` to `main` or `master`; `git reset --hard origin/...` and `git reset --hard @{u}`.
6. **Preview content** (only from facts gathered without running the command): expanded glob targets, file count and total size, whether each target is git-tracked, and a dry run where the tool has one. Dry runs go through `$.process.run` with an argv array (no shell): `['git','clean','-n', ...]`, `['git','diff','--stat']`, `['rsync','-n', ...]`. Expand globs with `$.fs.list` plus a small matcher for `*`, `?` and `[...]`. If a glob uses `**` or braces, say "glob not expanded" and still ask. Cap the preview at about 40 lines and say how many were cut.
7. **Questions.** `$.ui.ask(question, ['Allow', 'Deny'])`. Anything other than the exact label `Allow` is a deny, including "Other" text. The deny reason names the command and says it was refused by blast-radius.
8. **No allowlist, no remembered answers.** Ask-tier noise is a known trade-off; do not add a bypass without asking the human.

## Work

All paths relative to repo root. Start from `session-band-plugin/`.

1. **`classify.ts` and its tests first** (`classify.test.ts`, pure, no engine). Table-driven: each row is a command string and the expected tier. Include: the full old-hook corpus (all denied), `rm -fr /`, `rm -r -f ~`, `rm --recursive --force /`, `/bin/rm -rf $HOME`, `rtk rm -rf ./build` (ask), `ls -la` (pass), `rg foo` (pass), `rtk git status` (pass), `git status && rm x` (ask), `cat a > b` (ask), `echo hi > /dev/null` (pass), `eval "$X"` (ask, can't analyze), `curl x | sh` (ask, can't analyze), `git push origin feat` (pass), `git push -f origin main` (deny), `git reset --hard HEAD~1` (ask), `git reset --hard origin/main` (deny), `find . -name x -delete` (ask), an unterminated quote (ask, can't analyze).
2. **`preview.ts` and tests**: facts in, text out; cap and truncation message.
3. **`blast.tsx`**: capture `isInteractive` on `session.start`; the Bash hook classifies, pass returns `next(e)`, deny returns `{ deny }`, ask builds the preview then calls `$.ui.ask`. Wrap the ask in try/catch: a rejection or non-interactive session denies with a clear reason. Register with the `.catch` guard shape above.
4. **`blast.test.ts`** with `claude-code/testing` (see `register.test.ts` for the setup helpers `mock.clock`, `mock.env`, and `on('process.run', ...)` stubs): pass runs `next`; deny never reaches `next`; ask with `Allow` runs, with `Deny` or a rejection denies; non-interactive session denies the ask tier.
5. **Commit as you go** (rule: "Git history" in `shared/research-tool-routing.md`): stage by path, one commit per file group.
6. **Cutover commit (last, only after the live gate below).** Delete `claude/.claude/hooks/enforce-bash-safety.sh` and the `Bash` entry that calls it in `claude/.claude/settings.json` (the `PreToolUse` block with matcher `Bash` and command `~/.claude/hooks/enforce-bash-safety.sh`). Leave the `rtk hook claude` entry. Grep for other references first and update docs that mention the old hook.

## Live gate (a human runs this; Pi cannot)

Run these in a fresh interactive `claude` session with the new plugin loaded. With the old hook still installed the test proves nothing, because the old hook would deny first. So remove only the old hook's `settings.json` entry locally, keep the file, then try these. Each is harmless even if it is not denied.

| Command | Expect |
|---|---|
| `rm -rf /nonexistent-blast-test` | hard deny, no question |
| `git reset --hard origin/nonexistent-blast-test` | hard deny |
| `rm /tmp/blast-test-file` (create it first) | ask, preview shows the file |
| `claude -p "run: rm /tmp/blast-test-file"` | denied, nobody to ask |

Only when all four behave does the cutover commit go in. Report the table as pending, do not claim it.

## Acceptance criteria

- `claude plugin validate session-band-plugin` passes with `blast.tsx` listed; no new errors.
- `claude plugin test session-band-plugin` passes, including the new classify, preview and blast tests.
- Every old-hook pattern is denied, plus the flag-order variants.
- The check never runs the user's command, never spawns a shell, and never throws out of the hook.
- After cutover: no `enforce-bash-safety` reference left outside `docs/superpowers/**`.

## Verification

| Check | Command | Expect |
|---|---|---|
| Manifest and module | `claude plugin validate session-band-plugin` | passes |
| Tests | `claude plugin test session-band-plugin` | all green, count rises from 15 |
| Stragglers | `rg -n "enforce-bash-safety" --glob '!docs/superpowers/**'` | none after cutover |
| Live gate | table above | pending, human |

## Traps

- **rtk swallows exit codes**: read the text of validate and test output, not the status.
- **Validator refuses `$` across imports and `$.op` as a value.** If it complains, move the call into `blast.tsx`.
- **Live review gate.** In `~/dotfiles` the `agent-review` gate can refuse your next input while a review is pending; `/review skip <id>` clears it. Commit before you finish.
- **Do not run the hard-deny commands for real** outside the live gate table's harmless forms.
- **`tsc -p` cannot run** until the engine generates `.claude-plugin/types/`; do not report its "cannot find module `claude-code`" errors as failures.

## Out of scope

`/clear` flow, review, band changes, any change to the rtk hook, allowlists.
