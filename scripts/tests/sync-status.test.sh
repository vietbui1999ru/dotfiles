#!/usr/bin/env bash
# Test scripts/sync-status: pick gh for a GitHub origin and glab for anything
# else, share one output loop, and run the Linux stale-settings check even after
# a forge failure. Everything runs in a throwaway repo with a local bare remote;
# no real checkout is touched.

SYNC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/sync-status"
# Resolve bash before the cases narrow PATH to the stubs and system tools.
BASH_BIN=$(command -v bash) || { printf 'FAIL: bash not found\n' >&2; exit 1; }

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

dir=$(mktemp -d "${TMPDIR:-/tmp}/sync-status-test.XXXXXX")
dir=$(cd "$dir" && pwd -P)
trap 'rm -rf "$dir"' EXIT

# Local bare remote plus a seed commit on main.
git init -q --bare "$dir/remote.git"
git init -q -b main "$dir/seed"
git -C "$dir/seed" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git -C "$dir/seed" push -q "$dir/remote.git" main

# Keep only the tools sync-status actually calls, so a real gh/glab installed on
# the host cannot leak into a case that expects it to be absent.
mkdir -p "$dir/sysbin"
for cmd in git timeout sort paste comm jq; do
	p=$(command -v "$cmd") || fail "$cmd not installed"
	ln -s "$p" "$dir/sysbin/$cmd"
done

mkdir -p "$dir/bin" "$dir/glab-bin" "$dir/markers" "$dir/home/dotfiles/scripts"

cat >"$dir/bin/gh" <<EOF
#!/bin/sh
printf 'gh\n' >>"$dir/markers/gh"
printf '7\tfeature-github\topen\tbug\n'
EOF

cat >"$dir/glab-bin/glab" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >>"$dir/markers/glab-args"
[ "\${GLAB_MODE:-ok}" = fail ] && exit 1
printf '[{"iid":12,"source_branch":"feature-gitlab","draft":false,"labels":["bug","ui"]}]\n'
EOF

cat >"$dir/bin/uname" <<'EOF'
#!/bin/sh
printf '%s\n' "${FAKE_UNAME:-Darwin}"
EOF

cat >"$dir/home/dotfiles/scripts/claude-settings-render" <<EOF
#!/bin/sh
printf 'called\n' >>"$dir/markers/render"
printf 'claude-settings: stale\n'
exit 0
EOF

chmod +x "$dir/bin/gh" "$dir/glab-bin/glab" "$dir/bin/uname" \
	"$dir/home/dotfiles/scripts/claude-settings-render"

# origin is a relative local path whose first component is the forge host: fetch
# resolves it against the checkout, and `git remote get-url origin` still reports
# the host. This avoids git's insteadOf rewriting, which would hide the host from
# the script (and from `git remote get-url`).
make_repo() {
	local host=$1 name=$2 repo
	repo="$dir/$name"
	git clone -q "$dir/remote.git" "$repo" || return 1
	git -C "$repo" config user.name t
	git -C "$repo" config user.email t@t
	mkdir -p "$repo/$host" || return 1
	ln -s "$dir/remote.git" "$repo/$host/repo.git" || return 1
	git -C "$repo" config remote.origin.url "$host/repo.git"
	printf '%s\n' "$repo"
}

run_sync() {
	local repo=$1 path=$2 fake_uname=$3 glab_mode=$4
	out=$(cd "$repo" && HOME="$dir/home" PATH="$path" \
		FAKE_UNAME="$fake_uname" GLAB_MODE="$glab_mode" \
		"$BASH_BIN" "$SYNC" 2>&1)
	status=$?
}

contains() {
	case "$out" in
	*"$1"*) ;;
	*) fail "$2: missing '$1'; output was: $out" ;;
	esac
}

clear_markers() { rm -f "$dir/markers/"*; }

full_path="$dir/glab-bin:$dir/bin:$dir/sysbin"
plain_path="$dir/bin:$dir/sysbin"

# 1. GitHub origin: gh lists a pull request, printed as #7 with the GitHub header.
clear_markers
repo=$(make_repo github.com github) || exit 1
run_sync "$repo" "$full_path" Darwin ok
[ "$status" -eq 0 ] || fail "case 1: exit status $status"
contains "sync-status: open pull requests (number, branch, state, labels, files shared with this branch):" "case 1"
contains "#7" "case 1"

# 6. Darwin: the render script is never called, even though it exists.
[ ! -e "$dir/markers/render" ] || fail "case 6: render script called on Darwin"

# 2. GitLab origin: glab lists a merge request, printed as !12, and gh is not called.
clear_markers
repo=$(make_repo gitlab.example.com gitlab-ok) || exit 1
run_sync "$repo" "$full_path" Linux ok
[ "$status" -eq 0 ] || fail "case 2: exit status $status"
contains "sync-status: open merge requests (number, branch, state, labels, files shared with this branch):" "case 2"
contains "!12" "case 2"
[ ! -e "$dir/markers/gh" ] || fail "case 2: gh was called for a GitLab origin"
# 5. Linux with the render script: its stale-settings line comes through.
contains "claude-settings: stale" "case 5"
[ "$(cat "$dir/markers/glab-args")" = "mr list --output json --per-page 50" ] \
	|| fail "case 2: glab called with unexpected arguments"

# 3. GitLab origin with no glab on PATH: name the host and carry on.
clear_markers
repo=$(make_repo gitlab.example.com gitlab-noglab) || exit 1
run_sync "$repo" "$plain_path" Darwin ok
[ "$status" -eq 0 ] || fail "case 3: exit status $status"
contains "sync-status: no gh or glab for gitlab.example.com" "case 3"

# 4. GitLab origin and glab fails: say so, then still run the Linux settings check.
clear_markers
repo=$(make_repo gitlab.example.com gitlab-fail) || exit 1
run_sync "$repo" "$full_path" Linux fail
[ "$status" -eq 0 ] || fail "case 4: exit status $status"
contains "sync-status: glab mr list failed; open merge requests not checked" "case 4"
contains "claude-settings: stale" "case 4/5"
[ -e "$dir/markers/render" ] || fail "case 4: render script not called after a forge failure"

# 6. Darwin again, on the GitLab path: the render script is not called.
clear_markers
repo=$(make_repo gitlab.example.com gitlab-darwin) || exit 1
run_sync "$repo" "$full_path" Darwin ok
[ "$status" -eq 0 ] || fail "case 6: exit status $status"
[ ! -e "$dir/markers/render" ] || fail "case 6: render script called on Darwin"

printf 'PASS: sync-status\n'
