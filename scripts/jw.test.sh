#!/usr/bin/env bash
# Test scripts/jw: create a colocated jj workspace under .claude/worktrees/ on a
# real branch, refuse bad names and a dirty removal, and clean up both jj and git
# on removal. Everything runs in a throwaway repo with a local bare remote; no
# real checkout is touched.

JW="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/jw"
FUNNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/commit-funnel"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

command -v jj >/dev/null || fail "jj not installed"

dir=$(mktemp -d "${TMPDIR:-/tmp}/jw-test.XXXXXX")
dir=$(cd "$dir" && pwd -P)
trap 'rm -rf "$dir"' EXIT

# Keep every archive this test creates inside the throwaway directory.
export XDG_STATE_HOME="$dir/state"

# Local bare remote plus a seed commit, then a primary clone: origin/main exists.
git init -q --bare "$dir/remote.git"
git init -q -b main "$dir/seed"
git -C "$dir/seed" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git -C "$dir/seed" branch -M main
git -C "$dir/seed" push -q origin main 2>/dev/null \
  || { git -C "$dir/seed" remote add origin "$dir/remote.git"; git -C "$dir/seed" push -q origin main; }
git clone -q "$dir/remote.git" "$dir/repo"
main="$dir/repo"
git -C "$main" config user.name t
git -C "$main" config user.email t@t
(cd "$main" && jj git init --colocate >/dev/null)
(cd "$main" && jj bookmark track main@origin >/dev/null)

ws="$main/.claude/worktrees/ok"
branch=feat/ok

# Refuse to run on main or master, a branch longer than 16 characters, or an
# existing target directory; a refusal leaves no workspace behind.
# Always run jw from inside the throwaway primary: a test that ran it from the
# caller's cwd would operate on the real checkout.
run_jw() { (cd "$main" && "$JW" "$@"); }

expect_refusal() {
  local label=$1
  shift
  if "$@" >"$dir/out" 2>"$dir/err"; then
    fail "$label: expected a refusal, got success"
  fi
  [ -s "$dir/err" ] || fail "$label: refused without a message"
}

expect_refusal "branch main" run_jw new main
[ ! -e "$main/.claude/worktrees/main" ] || fail "created a workspace for main"
expect_refusal "branch master" run_jw new master
[ ! -e "$main/.claude/worktrees/master" ] || fail "created a workspace for master"
expect_refusal "branch over 16 characters" run_jw new feat/this-branch-is-too-long
[ ! -e "$main/.claude/worktrees/this-branch-is-too-long" ] || fail "created an over-long workspace"

# new: creates the workspace, prints its absolute path, attaches HEAD and the
# branch in git, and leaves the primary on main.
out=$(run_jw new "$branch") || fail "jw new failed: $(cat "$dir/err")"
[ "$out" = "$ws" ] || fail "new printed '$out', expected '$ws'"
[ -d "$ws" ] || fail "workspace directory missing"
[ -d "$ws/.jj" ] || fail "workspace not colocated"
[ "$(git -C "$ws" branch --show-current)" = "$branch" ] || fail "HEAD not attached to $branch"
git -C "$main" worktree list --porcelain | grep -qxF "worktree $ws" \
  || fail "git worktree list does not show $ws"
git -C "$main" worktree list --porcelain | grep -qxF "branch refs/heads/$branch" \
  || fail "git worktree list does not show $branch"
[ "$(git -C "$main" branch --show-current)" = main ] || fail "primary left main"
[ -d "$main/.jj" ] || fail "primary lost its .jj"

expect_refusal "existing target directory" run_jw new "$branch"

# A funnel commit in the workspace moves the branch and keeps HEAD attached.
before=$(git -C "$main" rev-parse "refs/heads/$branch")
printf 'hello\n' >"$ws/file.txt"
printf 'test: funnel commit\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' >"$dir/msg"
(cd "$ws" && "$FUNNEL" --worktree "$ws" -F "$dir/msg" file.txt) >/dev/null \
  || fail "funnel commit failed"
after=$(git -C "$main" rev-parse "refs/heads/$branch")
[ "$before" != "$after" ] || fail "funnel commit did not move $branch"
[ "$(git -C "$ws" branch --show-current)" = "$branch" ] || fail "funnel left HEAD detached"
[ "$(git -C "$main" branch --show-current)" = main ] || fail "funnel moved the primary off main"

# rm refuses a dirty workspace and leaves it registered in jj and git.
printf 'dirty\n' >>"$ws/file.txt"
expect_refusal "rm on a dirty workspace" run_jw rm ok
[ -d "$ws" ] || fail "rm removed a dirty workspace"
(cd "$main" && jj workspace list | grep -q '^ok: ') || fail "dirty workspace left jj"
git -C "$main" worktree list | grep -q "$ws" || fail "dirty workspace left git"

# rm cleans both jj and git, and never deletes the branch.
git -C "$ws" checkout -- file.txt
run_jw rm ok || fail "jw rm failed: $(cat "$dir/err")"
[ ! -e "$ws" ] || fail "workspace directory survived rm"
(cd "$main" && jj workspace list | grep -q '^ok: ') && fail "jj workspace survived rm"
git -C "$main" worktree list | grep -q "$ws" && fail "git worktree entry survived rm"
git -C "$main" rev-parse --verify -q "refs/heads/$branch" >/dev/null \
  || fail "rm deleted the branch"
[ "$(git -C "$main" branch --show-current)" = main ] || fail "rm moved the primary off main"

# rm refuses a name with a slash or "..", before it touches anything: a name
# like ../../.. resolves outside the worktrees directory.
decoy="$main/.claude/worktrees/decoy-target"
mkdir -p "$decoy" && git -C "$decoy" init -q \
  && git -C "$decoy" -c user.name=t -c user.email=t@t commit -q --allow-empty -m keep \
  && printf 'keep\n' >"$decoy/keep.txt" && git -C "$decoy" add keep.txt \
  && git -C "$decoy" -c user.name=t -c user.email=t@t commit -q -m keep
expect_refusal "rm with a path name" run_jw rm "../worktrees/decoy-target"
expect_refusal "rm with a slash name" run_jw rm "a/b"
[ -f "$decoy/keep.txt" ] || fail "rm with a path name removed a directory"

# rm refuses a workspace holding gitignored content (node_modules, agent state),
# names the entries, and removes nothing.
ign="$main/.claude/worktrees/ign"
run_jw new feat/ign >/dev/null || fail "jw new feat/ign failed"
printf 'node_modules/\n' >"$ign/.gitignore"
git -C "$ign" add .gitignore && git -C "$ign" -c user.name=t -c user.email=t@t commit -q -m "ignore" >/dev/null
mkdir -p "$ign/node_modules/pkg" && printf 'x\n' >"$ign/node_modules/pkg/index.js"
expect_refusal "rm with gitignored content" run_jw rm ign
grep -q 'node_modules' "$dir/err" || fail "refusal did not name the ignored entry"
[ -f "$ign/node_modules/pkg/index.js" ] || fail "rm deleted gitignored content"
(cd "$main" && jj workspace list | grep -q '^ign: ') || fail "ignored-content refusal left jj"
rm -rf "$ign/node_modules"
run_jw rm ign >/dev/null || fail "rm ign failed after clearing ignored content"
[ ! -e "$ign" ] || fail "ign directory survived rm"

# rm deletes known caches, archives known records, and leaves tracked files in
# .agents/ alone. The archive keeps each record at its relative path.
arc_repo="$XDG_STATE_HOME/jw-archive/$(basename "$main")"
arc="$main/.claude/worktrees/arc"
run_jw new feat/arc >/dev/null || fail "jw new feat/arc failed"
mkdir -p "$arc/.agents/plugins" "$arc/scripts" || fail "arc setup: mkdir plugins and scripts"
printf '{}\n' >"$arc/.agents/plugins/marketplace.json" || fail "arc setup: $arc/.agents/plugins/marketplace.json"
printf 'keep\n' >"$arc/scripts/keep.txt" || fail "arc setup: $arc/scripts/keep.txt"
printf '%s\n' '__pycache__/' '.ruff_cache/' '.pi/' '.agents/events.jsonl' '.agents/sessions/' '.pi-lens-probe-home/' '.serena/' >"$arc/.gitignore" || fail "arc setup: $arc/.gitignore"
git -C "$arc" add .gitignore .agents/plugins/marketplace.json scripts/keep.txt \
  || fail "arc setup add failed"
git -C "$arc" -c user.name=t -c user.email=t@t commit -q -m "records" >/dev/null \
  || fail "arc setup commit failed"
mkdir -p "$arc/scripts/__pycache__" "$arc/.ruff_cache" \
  "$arc/.pi/records" "$arc/.pi-lens-probe-home" "$arc/.serena" || fail "arc setup: mkdir caches and records"
printf 'x\n' >"$arc/scripts/__pycache__/x.pyc" || fail "arc setup: $arc/scripts/__pycache__/x.pyc"
printf 'x\n' >"$arc/.ruff_cache/x" || fail "arc setup: $arc/.ruff_cache/x"
printf '{"run":"ok"}\n' >"$arc/.pi/records/run.json" || fail "arc setup: $arc/.pi/records/run.json"
printf 'event\n' >"$arc/.agents/events.jsonl" || fail "arc setup: $arc/.agents/events.jsonl"
mkdir -p "$arc/.agents/sessions" || fail "arc setup: mkdir sessions"
printf 'note\n' >"$arc/.agents/sessions/note.md" || fail "arc setup: $arc/.agents/sessions/note.md"
printf 'log\n' >"$arc/.pi-lens-probe-home/latency.log" || fail "arc setup: $arc/.pi-lens-probe-home/latency.log"
printf 'project\n' >"$arc/.serena/project.yml" || fail "arc setup: $arc/.serena/project.yml"
run_jw rm arc >/dev/null || fail "jw rm arc failed: $(cat "$dir/err")"
[ ! -e "$arc" ] || fail "arc workspace survived rm"
(cd "$main" && jj workspace list | grep -q '^arc: ') && fail "arc left jj"
git -C "$main" worktree list | grep -q "$arc" && fail "arc left git"
[ "$(find "$arc_repo" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" -eq 1 ] \
  || fail "expected exactly one archive folder"
arch=$(find "$arc_repo" -mindepth 1 -maxdepth 1 -type d -print -quit)
for kept in .pi/records/run.json .agents/events.jsonl \
  .agents/sessions/note.md .pi-lens-probe-home/latency.log .serena/project.yml jw-meta.txt; do
  [ -f "$arch/$kept" ] || fail "archive missing $kept"
done
[ -z "$(find "$arch" -name '__pycache__' -o -name '.ruff_cache' -o -name marketplace.json)" ] \
  || fail "archive holds a deleted cache or the tracked marketplace file"

# An unknown ignored entry stops everything: no delete, no archive.
unk_repo="$arc_repo"
unk="$main/.claude/worktrees/unk"
run_jw new feat/unk >/dev/null || fail "jw new feat/unk failed"
printf '%s\n' '.pi/' 'node_modules/' >"$unk/.gitignore"
git -C "$unk" add .gitignore \
  || fail "unk setup add failed"
git -C "$unk" -c user.name=t -c user.email=t@t commit -q -m "ignore" >/dev/null \
  || fail "unk setup commit failed"
mkdir -p "$unk/.pi" "$unk/node_modules/pkg"
printf 'x\n' >"$unk/.pi/x"
printf 'y\n' >"$unk/node_modules/pkg/index.js"
expect_refusal "rm with an unknown ignored entry" run_jw rm unk
grep -q 'node_modules' "$dir/err" || fail "refusal did not name the unknown entry"
[ -f "$unk/.pi/x" ] || fail "unknown refusal deleted an archivable entry"
[ -z "$(find "$unk_repo" -maxdepth 1 -name 'unk-*')" ] || fail "unknown refusal created an archive"
rm -rf "$unk/node_modules"
run_jw rm unk >/dev/null || fail "rm unk failed after clearing node_modules"
[ ! -e "$unk" ] || fail "unk workspace survived rm"

# After a successful removal, archive folders older than 14 days are pruned.
old=$(date -v-15d +%Y%m%d%H%M 2>/dev/null || date -d '15 days ago' +%Y%m%d%H%M)
mkdir -p "$arc_repo/old-archive" "$arc_repo/new-archive"
touch -t "$old" "$arc_repo/old-archive"
run_jw new feat/prune >/dev/null || fail "jw new feat/prune failed"
run_jw rm prune >/dev/null || fail "jw rm prune failed"
[ ! -e "$arc_repo/old-archive" ] || fail "old archive was not pruned"
[ -d "$arc_repo/new-archive" ] || fail "prune removed a fresh archive"

# new refuses names outside the allow-list; rm refuses non-plain workspace names.
for bad in wip/x feat/../x feat/Upper feat/-x 'feat/a b' feat/abcdefghijkl; do
  expect_refusal "new $bad" run_jw new "$bad"
done
for leftover in "$main/.claude/worktrees"/*; do
  [ -e "$leftover" ] || continue
  [ "$(basename "$leftover")" = decoy-target ] && continue
  fail "a refused name left a workspace: $leftover"
done
expect_refusal "rm with an uppercase name" run_jw rm Bad_Name

# --full is refused in any position until full mode (S4) exists.
expect_refusal "new --full" run_jw new --full feat/full
expect_refusal "new --full=10m" run_jw new feat/full --full=10m
[ ! -e "$main/.claude/worktrees/full" ] || fail "--full created a workspace"

# bg: creates the workspace, then runs claude --bg there with the prompt as one word.
mkdir -p "$dir/bin"
# shellcheck disable=SC2016 # the format is for the generated script, not this one
printf '#!/bin/sh\npwd -P >"%s/claude.out"\nfor a; do printf "[%%s]\\n" "$a"; done >>"%s/claude.out"\n' \
  "$dir" "$dir" >"$dir/bin/claude"
chmod +x "$dir/bin/claude"
bgws="$main/.claude/worktrees/bgx"
# shellcheck disable=SC2016 # the literal metacharacters are the point
prompt='do a; then b | c $(id)'
export SECRETS_ENV="$dir/no-secrets.env"  # the plain path; with-secrets has its own tests
(cd "$main" && PATH="$dir/bin:$PATH" "$JW" bg feat/bgx "$prompt") || fail "jw bg failed"
[ "$(sed -n 1p "$dir/claude.out")" = "$bgws" ] || fail "bg ran claude outside $bgws"
[ "$(sed -n 2p "$dir/claude.out")" = "[--bg]" ] || fail "bg did not pass --bg"
[ "$(sed -n 3p "$dir/claude.out")" = "[$prompt]" ] || fail "bg split or changed the prompt"
[ "$(wc -l <"$dir/claude.out")" -eq 3 ] || fail "bg passed extra arguments"

# bg reuses a workspace on the same branch and refuses one on another branch.
(cd "$main" && PATH="$dir/bin:$PATH" "$JW" bg feat/bgx again) || fail "bg on an existing workspace failed"
expect_refusal "bg branch mismatch" run_jw bg fix/bgx hi
expect_refusal "bg empty prompt" run_jw bg feat/bgx ''
: >"$dir/claude.out"
expect_refusal "bg option-shaped prompt" run_jw bg feat/bgx '--settings={"sandbox":{"enabled":false}}'
expect_refusal "bg dash prompt" run_jw bg feat/bgx '-p'
[ ! -s "$dir/claude.out" ] || fail "an option-shaped prompt reached claude"
expect_refusal "bg bad branch" run_jw bg main hi
run_jw rm bgx >/dev/null || fail "rm bgx failed"

# ls and sweep. Fake gh and lsof sit first on PATH; the test writes their answers
# to files, so each case controls the merged PRs, the live cwds and failures.
fake="$dir/fake"
mkdir -p "$fake" || fail "fake setup mkdir failed"
cat >"$fake/gh" <<'GH'
#!/bin/sh
[ -e "$FAKE_DIR/gh-fail" ] && exit 1
cat "$FAKE_DIR/merged.json"
GH
cat >"$fake/lsof" <<'LSOF'
#!/bin/sh
[ -e "$FAKE_DIR/lsof-fail" ] && exit 2
[ -s "$FAKE_DIR/live" ] || exit 1
while IFS= read -r p; do printf 'n%s\n' "$p"; done <"$FAKE_DIR/live"
LSOF
chmod +x "$fake/gh" "$fake/lsof" || fail "fake chmod failed"
export FAKE_DIR="$fake"
run_ls() { (cd "$main" && PATH="$fake:$PATH" "$JW" ls); }
run_sweep() { (cd "$main" && PATH="$fake:$PATH" "$JW" sweep "$@"); }
row() { awk -F'\t' -v n="$1" '$1==n{print $3"\t"$4}' <<<"$2"; }

# Fixtures: one workspace per reason, each on its own branch with one commit.
mk_ws() {
  local n=$1 b=$2
  run_jw new "$b" >/dev/null || fail "ls fixture $b failed"
  printf '%s\n' "$n" >"$main/.claude/worktrees/$n/$n.txt" || fail "ls fixture write $n failed"
  git -C "$main/.claude/worktrees/$n" add "$n.txt" || fail "ls fixture add $n failed"
  git -C "$main/.claude/worktrees/$n" -c user.name=t -c user.email=t@t commit -q -m "$n" || fail "ls fixture commit $n failed"
}
mk_ws good feat/good
mk_ws unmerged feat/unmerged
mk_ws moved feat/moved
mk_ws live feat/live
mk_ws dirty feat/dirty
mk_ws unkls feat/unkls
mk_ws detached feat/detached
git -C "$main/.claude/worktrees/detached" checkout -q --detach || fail "detach fixture failed"

# unkls commits its .gitignore first, so its recorded merged oid is its final HEAD.
printf 'node_modules/\n' >"$main/.claude/worktrees/unkls/.gitignore" || fail "unk gitignore write failed"
git -C "$main/.claude/worktrees/unkls" add .gitignore || fail "unk gitignore add failed"
git -C "$main/.claude/worktrees/unkls" -c user.name=t -c user.email=t@t commit -q -m ignore || fail "unk gitignore commit failed"
mkdir -p "$main/.claude/worktrees/unkls/node_modules/pkg" || fail "unk mkdir failed"
printf 'x\n' >"$main/.claude/worktrees/unkls/node_modules/pkg/i.js" || fail "unk js write failed"

# Merged PRs: good, live, dirty, unkls are merged at their current HEAD; moved
# is merged at a stale oid.
good_oid=$(git -C "$main/.claude/worktrees/good" rev-parse HEAD)
live_oid=$(git -C "$main/.claude/worktrees/live" rev-parse HEAD)
dirty_oid=$(git -C "$main/.claude/worktrees/dirty" rev-parse HEAD)
unk_oid=$(git -C "$main/.claude/worktrees/unkls" rev-parse HEAD)
printf '[{"headRefName":"feat/good","headRefOid":"%s"},{"headRefName":"feat/live","headRefOid":"%s"},{"headRefName":"feat/dirty","headRefOid":"%s"},{"headRefName":"feat/unkls","headRefOid":"%s"},{"headRefName":"feat/moved","headRefOid":"0000000000000000000000000000000000000000"}]\n' \
  "$good_oid" "$live_oid" "$dirty_oid" "$unk_oid" >"$fake/merged.json" || fail "merged.json write failed"
: >"$fake/live" || fail "live reset failed"
printf '%s\n' "$(cd "$main/.claude/worktrees/live" && pwd -P)" >"$fake/live" || fail "live write failed"
printf 'dirty\n' >>"$main/.claude/worktrees/dirty/dirty.txt" || fail "dirty write failed"

ls_out=$(run_ls) || fail "jw ls failed"
[ "$(row good "$ls_out")" = "$(printf 'sweep\tok')" ] || fail "ls: good not sweep: $(row good "$ls_out")"
[ "$(row unmerged "$ls_out")" = "$(printf 'keep\tnot merged')" ] || fail "ls: unmerged reason wrong"
[ "$(row moved "$ls_out")" = "$(printf 'keep\tnewer commits')" ] || fail "ls: moved reason wrong"
[ "$(row live "$ls_out")" = "$(printf 'keep\tlive')" ] || fail "ls: live reason wrong"
[ "$(row dirty "$ls_out")" = "$(printf 'keep\tuncommitted')" ] || fail "ls: dirty reason wrong"
[ "$(row unkls "$ls_out")" = "$(printf 'keep\tunknown ignored: node_modules')" ] || fail "ls: unknown reason wrong: $(row unkls "$ls_out")"
[ "$(row detached "$ls_out")" = "$(printf 'keep\tdetached')" ] || fail "ls: detached reason wrong"
[ "$(printf '%s\n' "$ls_out" | awk -F'\t' '$3=="sweep"' | wc -l | tr -d ' ')" -eq 1 ] || fail "ls: expected exactly one sweep row"

# gh failure: every row is keep with merged?.
printf 'x\n' >"$fake/gh-fail"
gh_out=$(run_ls) || fail "jw ls failed with gh down"
[ "$(printf '%s\n' "$gh_out" | awk -F'\t' '$3=="keep" && $4=="merged?"' | wc -l | tr -d ' ')" -eq "$(printf '%s\n' "$gh_out" | grep -c .)" ] || fail "gh failure did not keep every row with merged?: $(printf '%s' "$gh_out" | tr '\n' '|')"
rm -f "$fake/gh-fail"

# lsof failure: every otherwise-sweepable row becomes live?.
printf 'x\n' >"$fake/lsof-fail"
lsof_out=$(run_ls) || fail "jw ls failed with lsof down"
[ "$(row good "$lsof_out")" = "$(printf 'keep\tlive?')" ] || fail "lsof failure did not give live? for good"
rm -f "$fake/lsof-fail"

# sweep preview removes nothing and names the one sweepable workspace.
preview=$(run_sweep 2>"$dir/err") || fail "jw sweep preview failed"
[ "$preview" = good ] || fail "sweep preview listed '$preview', expected good"
grep -q 'would be removed' "$dir/err" || fail "sweep preview did not explain the count"
[ -d "$main/.claude/worktrees/good" ] || fail "sweep preview removed good"

# sweep --apply removes only the sweepable workspace; everything else and every
# branch survives. The rm path also archives nothing here (no ignored records).
run_sweep --apply >"$dir/out" 2>"$dir/err" || fail "jw sweep --apply failed: $(cat "$dir/err")"
[ ! -e "$main/.claude/worktrees/good" ] || fail "sweep --apply did not remove good"
(cd "$main" && jj workspace list | grep -q '^good: ') && fail "sweep --apply left good in jj"
git -C "$main" worktree list | grep -q 'worktrees/good$' && fail "sweep --apply left good in git"
git -C "$main" rev-parse --verify -q refs/heads/feat/good >/dev/null || fail "sweep --apply deleted the branch"
for keep_ws in unmerged moved live dirty unkls detached; do
  [ -d "$main/.claude/worktrees/$keep_ws" ] || fail "sweep --apply removed $keep_ws"
done
for keep_b in feat/unmerged feat/moved feat/live feat/dirty feat/unkls feat/detached; do
  git -C "$main" rev-parse --verify -q "refs/heads/$keep_b" >/dev/null || fail "sweep --apply deleted $keep_b"
done

# Argument errors: sweep takes only --apply.
expect_refusal "sweep with a bad flag" run_sweep --force
expect_refusal "sweep with two flags" run_sweep --apply --apply

printf 'PASS: jw\n'
