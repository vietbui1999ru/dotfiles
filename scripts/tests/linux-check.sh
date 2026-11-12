#!/usr/bin/env bash
# linux-check.sh — run the agent scripts' test set on Linux, before and after the lx fixes.
#
# Runs as root inside a fresh ubuntu:24.04 container. The repo is mounted read-only at /src
# (the main checkout, whose .git holds every branch). Nothing is written to /src.
#
#   linux-check.sh [branch ...]     default: the seven fix/lx-* branches
#
# Baseline = main. Fixed = a throwaway branch lx-all merged from the requested branches.
# Exit 0 when the fixed tree has no failure the baseline did not also have, else 1.
set -u

DEFAULT_BRANCHES=(fix/lx-settings fix/lx-dispatch fix/lx-secret fix/lx-pisbx fix/lx-sync fix/lx-paths fix/lx-sweep)
if (( $# )); then BRANCHES=("$@"); else BRANCHES=("${DEFAULT_BRANCHES[@]}"); fi

REPORT_LINES=()
say() { echo "$*"; REPORT_LINES+=("$*"); }
die() { say "linux-check: $*"; write_report; exit 1; }

write_report() {
	if [[ -d /out && -w /out ]]; then
		printf '%s\n' "${REPORT_LINES[@]}" > /out/linux-check.txt
	fi
}

# 1. Refuse outside a container.
if [[ ! -e /src/.git ]]; then
	echo "linux-check: /src/.git not found; mount the repo at /src (read-only). Refusing." >&2
	exit 1
fi
if [[ "$(uname -s)" != Linux ]]; then
	echo "linux-check: not Linux; this check runs inside the ubuntu container. Refusing." >&2
	exit 1
fi
if [[ "$(id -u)" != 0 ]]; then
	echo "linux-check: must run as root inside the container. Refusing." >&2
	exit 1
fi

# 2. Install tools. pueue is used only when already on PATH; nothing is downloaded beyond apt.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || die "apt-get update failed"
apt-get install -y -qq zsh nodejs python3 python3-yaml git jq stow coreutils openssl ca-certificates sudo \
	|| die "apt-get install failed"

HAVE_PUEUE=0
if command -v pueue >/dev/null 2>&1 && command -v pueued >/dev/null 2>&1; then HAVE_PUEUE=1; fi

# 3. User and clone.
if ! id tester >/dev/null 2>&1; then
	useradd -m -u 1000 -s "$(command -v zsh)" tester || die "useradd failed"
fi
TESTER_HOME=$(getent passwd tester | cut -d: -f6)
as_tester() { sudo -u tester -H env HOME="$TESTER_HOME" PATH="$PATH" bash -lc "$1"; }

git config --system --add safe.directory /src
as_tester "git config --global --add safe.directory /src && \
	git clone -q /src \$HOME/dotfiles && \
	cd \$HOME/dotfiles && \
	git config user.name 'linux-check' && git config user.email 'linux-check@example.invalid'" \
	|| die "clone failed"
REPO="$TESTER_HOME/dotfiles"

# Refresh remote-tracking refs from /src so origin/<branch> exists.
as_tester "cd $REPO && git fetch -q origin '+refs/heads/*:refs/remotes/origin/*'" || die "fetch failed"

# The test set, run with the repo as cwd. Prints one line per file: "PASS|FAIL <file>".
# Each file runs in isolation; a failure does not stop the rest.
TEST_SCRIPT=$(cat <<'EOS'
set -u
run_one() {
	local label="$1"; shift
	if "$@" >/tmp/lc-out.$$ 2>&1; then echo "PASS|$label"; else echo "FAIL|$label"; sed -n '1,20p' /tmp/lc-out.$$ | sed 's/^/    /' >&2; fi
	rm -f /tmp/lc-out.$$
}
cd "$HOME/dotfiles" || exit 1
for f in scripts/*.test.mjs; do [[ -e $f ]] && run_one "$f" node --test "$f"; done
for f in scripts/tests/test_*.py; do [[ -e $f ]] && run_one "$f" python3 "$f"; done
[[ -e scripts/jw.test.sh ]] && run_one scripts/jw.test.sh bash scripts/jw.test.sh
for f in scripts/tests/*.test.sh; do [[ -e $f ]] && run_one "$f" bash "$f"; done
for f in claude/.claude/hooks/tests/*.test.sh; do [[ -e $f ]] && run_one "$f" bash "$f"; done
EOS
)

# Result table: one row per test file, keyed by name. Written to a file the host shell reads.
TMP_DIR=$(mktemp -d)
run_tests() { # $1 = label for the output file
	as_tester "$TEST_SCRIPT" > "$TMP_DIR/$1.res" 2>"$TMP_DIR/$1.err"
	cat "$TMP_DIR/$1.err" >&2
}

result_of() { # $1 = tag, $2 = file -> PASS|FAIL|MISSING
	local status
	status=$(awk -F'|' -v f="$2" '$2 == f { print $1; exit }' "$TMP_DIR/$1.res")
	echo "${status:-MISSING}"
}

# 4. Baseline on main.
as_tester "cd $REPO && git checkout -q main" || die "checkout main failed"
say "== baseline: main =="
run_tests baseline

# 5. Fixed tree: lx-all from main, merge each requested branch.
as_tester "cd $REPO && git checkout -q -B lx-all main" || die "create lx-all failed"
for b in "${BRANCHES[@]}"; do
	if ! as_tester "cd $REPO && git merge -q --no-edit origin/$b"; then
		as_tester "cd $REPO && git merge --abort" >/dev/null 2>&1 || true
		die "merge conflict on origin/$b; not resolved. Stopping."
	fi
	say "merged origin/$b"
done

# 6. Test set on lx-all.
say "== fixed: lx-all =="
run_tests fixed

# 7. Extra checks on lx-all.
EXTRA_RESULTS=()
extra() { EXTRA_RESULTS+=("$1|$2|$3"); }   # name status reason

# Use the tester's own helper scripts; each check runs as tester in the clone.
EXTRA_SCRIPT=$(cat <<'EOS'
set -u
cd "$HOME/dotfiles" || exit 1
H="$HOME"
emit() { printf 'RESULT|%s|%s|%s\n' "$1" "$2" "$3"; }

# (a) stow must not link claude/.claude/settings.json; must mention the template or its parent.
if ! command -v stow >/dev/null; then
	emit stow SKIP "stow not installed"
else
	out=$(stow -n -v --target="$H" --ignore='\.claude/settings\.json' claude 2>&1)
	if printf '%s\n' "$out" | grep -q 'LINK.*\.claude/settings\.json'; then
		emit stow-settings-skipped FAIL "stow still links .claude/settings.json"
	elif printf '%s\n' "$out" | grep -qE 'templates/hooks/settings\.json|templates/hooks'; then
		emit stow-settings-skipped PASS "settings.json not linked; template referenced"
	else
		emit stow-settings-skipped FAIL "output does not mention templates/hooks/settings.json or its parent"
	fi
fi

# (b) claude-settings-render.
if [[ ! -x scripts/claude-settings-render ]]; then
	emit claude-settings-render SKIP "scripts/claude-settings-render not on lx-all (branch fix/lx-settings not merged)"
else
	if scripts/claude-settings-render >/dev/null 2>&1 && [[ -f $H/.claude/settings.json ]]; then
		bad=$(jq -r '.sandbox.excludedCommands[]? | select(startswith("/home/tester/dotfiles/scripts/") | not)' "$H/.claude/settings.json")
		uv=$(jq -r '(.sandbox.filesystem.allowWrite // .sandbox.allowWrite // [])[] | select(. == "~/.cache/uv" or endswith("/.cache/uv"))' "$H/.claude/settings.json")
		second=$(scripts/claude-settings-render 2>&1)
		if [[ -n $bad ]]; then emit claude-settings-render FAIL "excludedCommands outside scripts/: $bad"
		elif [[ -z $uv ]]; then emit claude-settings-render FAIL "allowWrite lacks ~/.cache/uv"
		elif [[ -n $second ]]; then emit claude-settings-render FAIL "second run printed output"
		else
			echo "hand edit" >> "$H/.claude/settings.json"
			scripts/claude-settings-render >/dev/null 2>&1; edited_rc=$?
			scripts/claude-settings-render --check >/dev/null 2>&1; check_rc=$?
			if [[ $edited_rc -ne 1 ]]; then emit claude-settings-render FAIL "hand-edited file: render exited $edited_rc, expected 1"
			elif [[ $check_rc -ne 0 ]]; then emit claude-settings-render FAIL "--check exited $check_rc after restore"
			else emit claude-settings-render PASS "render, idempotent, hand-edit refused"; fi
		fi
	else
		emit claude-settings-render FAIL "render did not write ~/.claude/settings.json"
	fi
fi

# (c) secret-get modes.
if [[ ! -x scripts/secret-get ]]; then
	emit secret-get SKIP "scripts/secret-get not on lx-all (branch fix/lx-secret not merged)"
else
	sd=$(mktemp -d "$H/sec.XXXX"); chmod 700 "$sd"; printf 'LC_PROBE=hello\n' > "$sd/.env"; chmod 600 "$sd/.env"
	got=$(SECRETS_ENV="$sd/.env" scripts/secret-get LC_PROBE 2>/dev/null); rc1=$?
	chmod 644 "$sd/.env"; SECRETS_ENV="$sd/.env" scripts/secret-get LC_PROBE >/dev/null 2>&1; rc2=$?
	rm -rf "$sd"
	if [[ $rc1 -eq 0 && $got == hello && $rc2 -eq 2 ]]; then emit secret-get PASS "700/600 returns value; 644 exits 2"
	else emit secret-get FAIL "value='$got' rc=$rc1 (want hello, 0); mode 644 rc=$rc2 (want 2)"; fi
fi

# (d) pi-sandbox on Linux, in a linked worktree under .claude/worktrees/.
if [[ ! -x scripts/pi-sandbox ]]; then
	emit pi-sandbox SKIP "scripts/pi-sandbox not on lx-all (branch fix/lx-pisbx not merged)"
else
	wt="$H/dotfiles/.claude/worktrees/lc-probe"
	git worktree add -q -b lc/probe "$wt" HEAD >/dev/null 2>&1
	optdir="$H/.config/pi-sandbox"; opt="$optdir/linux-open"
	rm -f "$opt"
	( cd "$wt" && "$H/dotfiles/scripts/pi-sandbox" true >/dev/null 2>&1 ); rc_no=$?
	mkdir -p "$optdir"; printf 'unsandboxed-ok %s\n' "$(hostname -s)" > "$opt"; chmod 600 "$opt"
	out=$( cd "$wt" && "$H/dotfiles/scripts/pi-sandbox" true 2>&1 ); rc_yes=$?
	rm -f "$opt"
	git worktree remove --force "$wt" >/dev/null 2>&1; git branch -D lc/probe >/dev/null 2>&1
	if [[ $rc_no -ne 1 ]]; then emit pi-sandbox FAIL "without opt-in exit $rc_no, expected 1"
	elif [[ $rc_yes -ne 0 ]] || ! printf '%s' "$out" | grep -q UNSANDBOXED; then emit pi-sandbox FAIL "with opt-in exit $rc_yes, no UNSANDBOXED line"
	else emit pi-sandbox PASS "refuses without opt-in; runs UNSANDBOXED with valid opt-in"; fi
fi

# (e) pi-dispatch end to end with a stub pi, only when pueue is present.
if ! command -v pueue >/dev/null || ! command -v pueued >/dev/null; then
	emit pi-dispatch SKIP "pueue not on PATH"
else
	pueued -d >/dev/null 2>&1; sleep 2
	wt="$H/dotfiles/.claude/worktrees/lc-dispatch"
	git worktree add -q -b lc/dispatch "$wt" HEAD >/dev/null 2>&1
	mkdir -p "$H/.pi/agent" "$H/.local/bin"
	printf '{"enabledModels":["opencode-go/high"]}\n' > "$H/.pi/agent/settings.json"
	printf '#!/usr/bin/env bash\necho stub-pi\n' > "$H/.local/bin/pi"; chmod 755 "$H/.local/bin/pi"
	printf 'PI_DELEGATE_HIGH_MODEL=opencode-go/high\n' > "$H/.lc-routing.env"
	printf 'probe task\n' > "$wt/lc-task.md"
	out=$(PATH="$H/.local/bin:$PATH" PI_ROUTING_ENV="$H/.lc-routing.env" \
		scripts/pi-dispatch add --model opencode-go/high --mode view --task-file "$wt/lc-task.md" --cwd "$wt" 2>&1); rc=$?
	pueue wait --all >/dev/null 2>&1 || true
	pueue reset -f >/dev/null 2>&1 || true
	git worktree remove --force "$wt" >/dev/null 2>&1; git branch -D lc/dispatch >/dev/null 2>&1
	if [[ $rc -eq 0 ]] && printf '%s' "$out" | grep -q 'task='; then emit pi-dispatch PASS "queued; task= line printed"
	else emit pi-dispatch FAIL "rc=$rc; output: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"; fi
	pueue shutdown >/dev/null 2>&1 || true
fi
EOS
)

as_tester "$EXTRA_SCRIPT" > "$TMP_DIR/extra.res" 2>"$TMP_DIR/extra.err"
cat "$TMP_DIR/extra.err" >&2
while IFS='|' read -r tag name status reason; do
	[[ $tag == RESULT ]] || continue
	extra "$name" "$status" "$reason"
done < "$TMP_DIR/extra.res"
if (( ! HAVE_PUEUE )); then
	extra pi-dispatch SKIP "pueue not on PATH in this container"
fi

# 9. Report.
EXIT=0
say ""
say "== report =="
say "$(printf '%-44s %-10s %-10s' 'test file' 'baseline' 'fixed')"

# Union of test files from both runs; each result line is STATUS|file.
files=$(cut -d'|' -f2 "$TMP_DIR/baseline.res" "$TMP_DIR/fixed.res" | sort -u)
while IFS= read -r f; do
	[[ -z $f ]] && continue
	b=$(result_of baseline "$f"); x=$(result_of fixed "$f")
	say "$(printf '%-44s %-10s %-10s' "$f" "$b" "$x")"
	if [[ $x != PASS && $b == PASS ]]; then EXIT=1; fi
	# New failure = fixed fails and baseline did not also fail.
	if [[ $x == FAIL && $b != FAIL ]]; then EXIT=1; fi
	if [[ $x == MISSING ]]; then EXIT=1; fi
done <<< "$files"

say ""
say "== extra checks (lx-all) =="
for row in "${EXTRA_RESULTS[@]}"; do
	IFS='|' read -r name status reason <<< "$row"
	say "$(printf '%-28s %-6s %s' "$name" "$status" "$reason")"
	if [[ $status == FAIL ]]; then EXIT=1; fi
done

write_report
exit $EXIT
