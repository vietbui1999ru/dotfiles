#!/usr/bin/env bash
# Test enforce-bash-safety.sh: the secrets rule blocks every spelling of the
# secrets directory while the loaders still pass, and the older rules still block.

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/enforce-bash-safety.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

dir=$(mktemp -d "${TMPDIR:-/tmp}/bash-safety-test.XXXXXX")
trap 'rm -rf "$dir"' EXIT
export SAFETY_LOG_DIR="$dir/state"

# Exit status of the hook for one command. The JSON is quoted by jq, so a command
# with quotes, $ or backslashes arrives exactly as written.
status() {
	printf '{"tool_input":{"command":%s},"cwd":"%s"}' "$(printf '%s' "$1" | jq -Rs .)" "$PWD" |
		"$HOOK" >/dev/null 2>&1
	echo $?
}

blocked() { [ "$(status "$1")" = 2 ]; }
allowed() { [ "$(status "$1")" = 0 ]; }

# Every spelling of the directory, including a quoted one and a directory listing.
for cmd in \
	'cat ~/secrets/.env' \
	'cat $HOME/secrets/.env' \
	'cat ${HOME}/secrets/.env' \
	'cat "$HOME/secrets/.env"' \
	"cat '$HOME/secrets/.env'" \
	'cat ~/"sec"rets/.env' \
	'ls -la ~/secrets' \
	'cd ~/secrets && cat .env' \
	"SECRETS_ENV=$HOME/secrets/.env secret-get CONTEXT7_API_KEY" \
	"cat $HOME/secrets/.env"; do
	blocked "$cmd" || fail "not blocked: $cmd"
done

# The loaders and ordinary work still pass, and a bare relative spelling is any
# project's directory rather than this one.
for cmd in \
	'npm run build' \
	'git status' \
	'cat ~/secrets-backup/env' \
	'rg secrets docs/' \
	'rg -n secrets/.env docs/workflows/secrets.md' \
	'$HOME/dotfiles/scripts/secret-get CONTEXT7_API_KEY' \
	'$HOME/dotfiles/scripts/with-secrets --optional CONTEXT7_API_KEY -- opencode' \
	'printf "%s" "$KEY" | $HOME/dotfiles/scripts/redact'; do
	allowed "$cmd" || fail "wrongly blocked: $cmd"
done

# The rules that were here before must still hold.
blocked 'rm -rf /' || fail "rm -rf / no longer blocked"
blocked 'git push --force origin main' || fail "force push no longer blocked"
allowed 'rm -rf ./tmp' || fail "rm -rf ./tmp wrongly blocked"

# The block is logged under its own rule name, with the command redacted.
blocked 'cat ~/secrets/.env' || fail "secrets read not blocked before log check"
grep -q '"rule":"secrets-read"' "$SAFETY_LOG_DIR/bash-safety-blocks.jsonl" ||
	fail "no secrets-read entry in the block log"

# A session inside a worktree may not aim git or jj at the primary checkout: a
# path that is not its own workspace. The shared checkout is the human's.
WS=/Users/someone/repo/.claude/worktrees/feat-x
PRIMARY=/Users/someone/repo
# status_in <cwd> <command>: exit status of the hook for that command from that cwd.
status_in() {
	printf '{"tool_input":{"command":%s},"cwd":"%s"}' "$(printf '%s' "$2" | jq -Rs .)" "$1" |
		"$HOOK" >/dev/null 2>&1
	echo $?
}
blocked_in() { [ "$(status_in "$1" "$2")" = 2 ]; }
allowed_in() { [ "$(status_in "$1" "$2")" = 0 ]; }

for cmd in \
	"git -C $PRIMARY status" \
	"git -C $PRIMARY checkout main" \
	"git -C $PRIMARY/ fetch origin" \
	"git -C ~/repo status" \
	"git -C \$HOME/repo status" \
	"git --git-dir=$PRIMARY/.git status" \
	"git --git-dir $PRIMARY/.git status" \
	"git -R $PRIMARY status" \
	"GIT_DIR=$PRIMARY/.git git status" \
	"cd $PRIMARY && git status" \
	"cd $PRIMARY; git checkout main" \
	"jj -R $PRIMARY status" \
	"jj --repository $PRIMARY status" \
	"cd $PRIMARY && jj bookmark list" \
	"git -C $WS/../.. status" \
	"export GIT_DIR=$PRIMARY/.git && git status" \
	"GIT_DIR=$PRIMARY/.git; git status" \
	"git -C $WS/../../../repo status"; do
	blocked_in "$WS" "$cmd" || fail "session aimed at primary not blocked: $cmd"
done

# Its own workspace, and read-only commands with no path, still pass.
for cmd in \
	"git -C $WS status" \
	"git -C $WS/ log --oneline -1" \
	"cd $WS && git status" \
	"jj -R $WS status" \
	"git status" \
	"jj st" \
	"git log --oneline -3"; do
	allowed_in "$WS" "$cmd" || fail "session wrongly blocked: $cmd"
done

# Outside a worktree the same primary-aimed command is the human's own work.
allowed_in "$PRIMARY" "git -C $PRIMARY status" || fail "primary checkout wrongly blocked"

echo "enforce-bash-safety: ok"
