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

printf 'PASS: jw\n'
