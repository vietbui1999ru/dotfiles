# Consolidation Fixes — Work Order

Status: ready, 2026-09-16. **Execute before continuing `ai-workflow-consolidation.md`.**
Source: independent code review of commits `ece33a9`, `16798ef`, `0123006`, `4767971`.
Verdict: not safe to continue until items 1–5 are done. Phases 1–4 of the consolidation
(llm-wiki side) may proceed once items 1, 2 and 5 are done.

All `pi/` paths below are under `~/dotfiles/pi/.pi/agent/extensions/`.

## Process rules for this fix pass

Each numbered item is its own commit. Do not bundle. The review found phases bundled into
single commits and a feature added then deleted 14 minutes later inside a commit titled as a
removal; commits that match their titles are what make individual reverts possible.

## 1. Restore the live review gate — blocking

`~/.pi/agent/extensions/lib/review-auto-policy.ts` is a dangling symlink (target path is one
directory level short). `pi-review-gate.ts:56` imports it, so the gate extension most likely
fails to load, which means review is effectively off. Also dangling:
`lib/interactive-session-checkpoint.ts`. And `lib/nvim-rpc.ts` and `lib/openai-usage.ts` are
plain copies, not symlinks, so they will drift.

Fix: from `~/dotfiles`, run `stow -R pi`. Resolve any conflicts deliberately — do not use
`--adopt` without diffing, since it overwrites the repo copy with the live one. Then confirm
in a fresh Pi session that the review gate reports as loaded.

Verify: `find ~/.pi/agent/extensions -type l ! -exec test -e {} \; -print` prints nothing.

## 2. Unbreak Neovim on markdown — blocking

`nvim/.config/nvim/init.lua` still runs `require("custom.plugins.obsidian")` from a markdown
FileType autocmd (line 795 at HEAD, line 807 in the working tree), but `ece33a9` deleted that
module. Every markdown buffer raises module-not-found.

Fix: remove the `pack-obsidian` augroup/autocmd and the `gh("epwalsh/obsidian.nvim")` pack
entry (line 170). `init.lua` has unrelated uncommitted edits from another session — stage only
these hunks (`git add -p`).

Verify: `nvim --headless README.md +qa` exits with no error output.

## 3. Make the review gate fail closed — blocking, security

`pi-review-gate.ts` gained auto-apply (applying agent patches with no human review) and ships
it **enabled by default**. The policy deciding eligibility has confirmed bypasses. Fix all four
together:

- **3a. Default off.** `pi-review-gate.ts:85` — change `PI_REVIEW_GATE_AUTO_APPLY !== "0"` to
  `=== "1"`. Add a per-session cap on total auto-applied LOC; today limits are per batch only,
  so N batches of 300 LOC apply N×300 unreviewed.
- **3b. Renames and deletes.** `lib/review-auto-policy.ts:80` checks only `file.path`, never
  `oldPath`. Renaming `auth/session.ts` → `session.ts` is judged eligible, and
  `applyApproved` (`pi-review-gate.ts:862-864`) then deletes the protected original unreviewed.
  Check both paths; any rename or delete touching a protected path requires review.
- **3c. Protected paths.** `lib/review-auto-policy.ts:24-41`. Verified to auto-apply today:
  `.env.local`, `.env.production`, `config/.env.local`, `secrets.json`, `credentials.json`,
  `authentication/x.ts`, `src/auth.ts`, `.github/actions/a.yml`, `Dockerfile`, `Makefile`,
  `.husky/pre-commit`, `.npmrc`, `package.json`, `main.tf`, `infrastructure/x.tf`,
  `bin/deploy.sh`. Root cause: the regex at `:28` ends in `(\/|$)`, so `.env.<suffix>` can
  never match, and other patterns only match whole directory names. Switch to deny-by-default
  (allow known source extensions under known source dirs); match `.env*`, `*secret*`,
  `*credential*` on basename; add CI, container, build, and git-hook files.
- **3d. Verification config.** `pi-review-gate.ts:945-952` runs auto-apply verification inside
  the agent-authored sandbox using the sandbox's own config. An agent can weaken
  `tsconfig.json`, `biome.json`, eslint config, `package.json` scripts, or `.pi-lens.json` in
  the same batch and then pass. Protect every name in `MANIFEST_AND_CONFIG_NAMES`
  (`lib/post-run-verifier-core.ts`) in the auto-policy, and resolve verifier config from the
  main tree rather than the sandbox.

Add a regression test for every bypass listed above. The existing 22 tests pass but cover none
of them.

## 4. Verifier hangs forever on stray child processes

`post-run-verifier.ts:380-415` (`executeArgv`) settles only on `close`/`error` and on timeout
kills only the direct child pid. Grandchildren (vitest/jest workers, `go test` binaries, cargo)
keep stdout/stderr open, so `close` never fires and verification never resolves. That stalls
`tryAutoApply` and the 3-cycle repair cap never engages.

Fix: spawn with `detached: true`, kill the group with `process.kill(-child.pid, signal)`, and
settle on `exit` plus a short output-drain timeout rather than on `close`. Add a test with a
command that forks a long-lived child.

## 5. Tag the revert point

The consolidation plan requires a Phase 0 tag in both repos; none exists. After items 1–4 land,
tag `~/dotfiles` and `~/repos/llm-wiki` (e.g. `consolidation-phase0`).

## 6. Measure before any more Phase 5 deletions

DiffViewer was removed and `pi-review-gate.ts` kept with no measurement, which the plan flags as
its most expensive available mistake. Before further Phase 5 work, build the usage counter from
consolidation Phase 7 with support for Pi session transcripts, and record the review-gate
decision with its evidence in the consolidation doc. If the evidence favors DiffViewer, revert
`16798ef`.

## 7. Cleanup

- **Binary files** — `pi-review-gate.ts:846,869` read and write sandbox files as utf8, which
  corrupts binaries, and `parseChangedLines` (`:260`) counts binary diffs as 0 LOC so they always
  pass the limits. Copy Buffers without an encoding; mark binary files ineligible for auto-apply.
- **Dead suspension code** — `lib/review-gate-suspension.ts` and its handlers
  (`pi-review-gate.ts:1279-1335`, ~320 lines) have no emitter; the only consumer was deleted in
  `ece33a9`. Delete it. It also carries a latent bug (a `restore-only` state with no expiry can
  leave the gate disabled for the rest of the process).
- **Unanchored exclusions** — `EXCLUDED_PATTERNS` (`pi-review-gate.ts:433-445`) need `(^|/)`
  anchoring; top-level `node_modules/`, `dist/`, `build/`, `coverage/` currently flow into batches.
- **Silent batch drops** — `createBatchFromSandbox` (`:826`) swallows all errors and returns
  null, so a symlink escaping the project silently drops the batch. Persist it as blocked and
  notify instead.
- **nvim-rpc hardening** — `lib/nvim-rpc.ts`: require the socket owner uid to match the current
  user (the socket path is read from repo-controlled `.pi/nvim-servername`); assert module and
  function names match `^[\w.]+$`; write preview temp files with mode `0600`.
- **Stale references** — `README.md` lines 79, 106, 110, 191; `nvim/.config/nvim/README.md`
  198-200; tracked `opencode/.config/opencode/plugins/diffviewer.js`; tracked `scripts/ao`
  (defaults to the nonexistent `~/repos/AgentOps`).
- **Litter** — untracked `~/dotfiles/AgentOps/` is leftover Pi session runtime state from before
  the removal commit. Delete once no Pi session is using it.
- **Hidden behavior change to confirm** — `0123006` made `pi-status`/`pi-ai` load
  unconditionally in `init.lua` (previously gated on the `neovimCockpit` flag). Confirm intended;
  if so, note it in that area's docs.

## What was verified sound (no action)

`post-run-verifier` uses `shell:false` argv arrays, validates config (rejects NUL/CR/LF, caps
retries at 3), skips untrusted projects before executing, enforces per-command and total
deadlines, caps output, and never infers package scripts. Suspension tokens are sound
(randomUUID, single active suspension, phase-matched, TTL clamped). The side panel is
pre-existing untracked code brought under version control, not new scope.
