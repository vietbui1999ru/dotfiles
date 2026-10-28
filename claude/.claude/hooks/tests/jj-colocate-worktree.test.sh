#!/usr/bin/env bash
# Test jj-colocate-worktree.sh: a linked worktree under .claude/worktrees/ gets
# colocated (from a subdirectory cwd too), a checkout elsewhere is left alone,
# and a second run on a colocated worktree is a silent no-op.

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/jj-colocate-worktree.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

command -v jj >/dev/null || fail "jj not installed"

dir=$(mktemp -d "${TMPDIR:-/tmp}/jj-colocate-test.XXXXXX")
trap 'rm -rf "$dir"' EXIT
main="$dir/repo"
wt="$main/.claude/worktrees/t1"

git init -q -b main "$main"
git -C "$main" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git -C "$main" worktree add -q -b feat/t1 "$wt" main
mkdir -p "$wt/sub"

run_hook() { printf '{"cwd":"%s"}' "$1" | "$HOOK"; }

out=$(run_hook "$main")
[ -z "$out" ] || fail "printed output for main checkout"
[ ! -e "$main/.jj" ] || fail "colocated the main checkout"

out=$(run_hook "$wt/sub")
[ -z "$out" ] || fail "printed output for worktree"
[ -d "$wt/.jj" ] || fail "worktree not colocated"
[ "$(git -C "$wt" branch --show-current)" = feat/t1 ] || fail "worktree lost its branch"

out=$(run_hook "$wt")
[ -z "$out" ] || fail "second run printed output"

printf 'PASS: jj-colocate-worktree\n'
