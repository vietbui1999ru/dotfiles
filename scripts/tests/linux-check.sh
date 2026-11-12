#!/usr/bin/env bash
# linux-check.sh — run the agent scripts' test set on Linux, before and after the lx fixes.
#
# Runs as root inside a fresh ubuntu:24.04 container. The repo is mounted read-only at /src,
# but git never reads /src: the Mac's repository has extensions.relativeWorktrees, which
# Ubuntu's git 2.43 refuses. Instead the clone comes from a bundle the person creates on the Mac:
#
#   git -C ~/dotfiles bundle create ~/lx-out/dotfiles.bundle --branches
#
# which the container sees as /out/dotfiles.bundle. Recreate it after new commits.
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
BUNDLE=/out/dotfiles.bundle
if [[ ! -f $BUNDLE || ! -r $BUNDLE ]]; then
	echo "linux-check: $BUNDLE not readable. Create it on the Mac first:" >&2
	echo "  git -C ~/dotfiles bundle create ~/lx-out/dotfiles.bundle --branches" >&2
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
apt-get install -y -qq zsh python3 python3-yaml git jq stow coreutils openssl ca-certificates sudo curl gnupg \
	|| die "apt-get install failed"

# Node 24 from NodeSource: the tests need a current Node; Ubuntu's Node 18 cannot load them.
# No fallback to Node 18: if NodeSource cannot be reached, stop.
node_major=0
if command -v node >/dev/null; then node_major=$(node -p 'process.versions.node.split(".")[0]'); fi
if (( node_major < 24 )); then
	curl -fsSL https://deb.nodesource.com/setup_24.x | bash - || die "NodeSource setup failed; cannot install Node 24"
	apt-get install -y -qq nodejs || die "apt-get install nodejs (Node 24) failed"
fi
node_major=$(node -p 'process.versions.node.split(".")[0]')
(( node_major >= 24 )) || die "node is $(node --version); need 24 or later"

# 3. User and clone.
if ! id tester >/dev/null 2>&1; then
	useradd -m -s "$(command -v zsh)" tester || die "useradd failed"
fi
TESTER_HOME=$(getent passwd tester | cut -d: -f6)
as_tester() { sudo -u tester -H env HOME="$TESTER_HOME" PATH="$PATH" bash -lc "$1"; }

# The bundle is root-owned; copy it to a tester-readable temp file if a direct read fails.
BUNDLE_READ=$BUNDLE
if ! as_tester "test -r $BUNDLE"; then
	BUNDLE_READ="$TESTER_HOME/dotfiles.bundle"
	install -m 644 -o tester "$BUNDLE" "$BUNDLE_READ" || die "cannot copy $BUNDLE for tester"
fi
as_tester "git clone -q -b main $BUNDLE_READ \$HOME/dotfiles && \
	cd \$HOME/dotfiles && \
	git config user.name 'linux-check' && git config user.email 'linux-check@example.invalid' && \
	git config --global user.name 'linux-check' && git config --global user.email 'linux-check@example.invalid'" \
	|| die "clone failed"
REPO="$TESTER_HOME/dotfiles"

# The test set, run with the repo as cwd. Prints one line per file: "PASS|FAIL <file>".
# Each file runs in isolation; a failure does not stop the rest.
TEST_SCRIPT=$(cat <<'EOS'
set -u
run_one() {
	local label="$1"; shift
	if "$@" >/tmp/lc-out.$$ 2>&1; then echo "PASS|$label"; else
		echo "FAIL|$label"
		sed -n '1,20p' /tmp/lc-out.$$ | sed "s#^#DETAIL|$label|#"
	fi
	rm -f /tmp/lc-out.$$
}
# Run a shell test by its own shebang: directly when executable, else zsh or bash per line 1.
run_shell() {
	local f="$1" first
	case $f in
		scripts/jw.test.sh|claude/.claude/hooks/tests/jj-colocate-worktree.test.sh)
			command -v jj >/dev/null || { echo "SKIP|$f|jj not installed"; return; } ;;
		claude/.claude/hooks/tests/design-on-write.test.sh|scripts/tests/skill-vendor.test.sh)
			echo "SKIP|$f|needs arguments; not a standalone test"; return ;;
	esac
	if [[ -x $f ]]; then run_one "$f" "$f"; return; fi
	first=$(head -n1 "$f")
	if [[ $first == *zsh* ]]; then run_one "$f" zsh "$f"; else run_one "$f" bash "$f"; fi
}
cd "$HOME/dotfiles" || exit 1
for f in scripts/*.test.mjs; do [[ -e $f ]] && run_one "$f" node --test "$f"; done
for f in scripts/tests/test_*.py; do [[ -e $f ]] && run_one "$f" python3 "$f"; done
[[ -e scripts/jw.test.sh ]] && run_shell scripts/jw.test.sh
for f in scripts/tests/*.test.sh; do [[ -e $f ]] && run_shell "$f"; done
for f in claude/.claude/hooks/tests/*.test.sh; do [[ -e $f ]] && run_shell "$f"; done
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
	status=$(awk -F'|' -v f="$2" '$1 != "DETAIL" && $2 == f { print $1; exit }' "$TMP_DIR/$1.res")
	echo "${status:-MISSING}"
}

# 4. Baseline on main.
as_tester "cd $REPO && git checkout -q main" || die "checkout main failed"
say "== baseline: main =="
run_tests baseline

# 5. Fixed tree: lx-all from main, merge each requested branch.
as_tester "cd $REPO && git checkout -q -B lx-all main" || die "create lx-all failed"
for b in "${BRANCHES[@]}"; do
	if ! as_tester "cd $REPO && git rev-parse -q --verify refs/remotes/origin/$b" >/dev/null; then
		die "branch $b is not in the bundle; recreate it with --branches after committing."
	fi
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

# (a) stow must not link claude/.claude/settings.json; must link the template (or its parent).
# ~/.claude must exist first, or stow folds the whole folder into one link.
if ! command -v stow >/dev/null; then
	emit stow SKIP "stow not installed"
else
	mkdir -p "$H/.claude"
	out=$(stow -n -v --target="$H" --ignore='\.claude/settings\.json' claude 2>&1)
	head5=$(printf '%s\n' "$out" | head -n 5 | tr '\n' ' ')
	if printf '%s\n' "$out" | grep -qE 'LINK: \.claude/settings\.json( |$)'; then
		emit stow-settings-skipped FAIL "stow still links .claude/settings.json; first lines: $head5"
	elif printf '%s\n' "$out" | grep -qE 'LINK: \.claude/templates(/hooks(/settings\.json)?)?( |$)'; then
		emit stow-settings-skipped PASS "settings.json not linked; template linked"
	else
		emit stow-settings-skipped FAIL "no template LINK line; first lines: $head5"
	fi
fi

# (b) claude-settings-render.
if [[ ! -x scripts/claude-settings-render ]]; then
	emit claude-settings-render SKIP "scripts/claude-settings-render not on lx-all (branch fix/lx-settings not merged)"
else
	if scripts/claude-settings-render >/dev/null 2>&1 && [[ -f $H/.claude/settings.json ]]; then
		bad=$(jq -r --arg prefix "$H/dotfiles/scripts/" '.sandbox.excludedCommands[]? | select(startswith($prefix) | not)' "$H/.claude/settings.json")
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
			elif [[ $check_rc -ne 0 ]]; then emit claude-settings-render FAIL "--check exited $check_rc after a hand edit"
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

# 9. Report.
EXIT=0
say ""
say "== report =="
say "node: $(node --version)  python3: $(python3 --version 2>&1)  git: $(git --version)"
# Union of test files from both runs; each result line is STATUS|file.
files=$(awk -F'|' '$1 != "DETAIL" { print $2 }' "$TMP_DIR/baseline.res" "$TMP_DIR/fixed.res" | sort -u)

# Summary: group the files before the table, so the reader sees the answer first.
fixed_by=(); regress=(); both_fail=(); skipped=()
while IFS= read -r f; do
	[[ -z $f ]] && continue
	b=$(result_of baseline "$f"); x=$(result_of fixed "$f")
	if [[ $x == SKIP || $b == SKIP ]]; then skipped+=("$f"); continue; fi
	if [[ $x == PASS && ( $b == FAIL || $b == MISSING ) ]]; then fixed_by+=("$f")
	elif [[ $x != PASS && $b == PASS ]]; then regress+=("$f")
	elif [[ $x != PASS && $b != PASS ]]; then both_fail+=("$f")
	fi
done <<< "$files"

say "fixed by the branches (baseline FAIL/MISSING, fixed PASS): ${#fixed_by[@]}"
for f in "${fixed_by[@]}"; do say "    $f"; done
say "regressions (baseline PASS, fixed not PASS): ${#regress[@]}"
for f in "${regress[@]}"; do say "    $f"; done
say "failing on both trees (environment or pre-existing): ${#both_fail[@]}"
for f in "${both_fail[@]}"; do say "    $f"; done
say "skipped: ${#skipped[@]}"
if (( ${#skipped[@]} )); then
	say ""
	say "== skipped =="
	for f in "${skipped[@]}"; do
		reason=$(awk -F'|' -v f="$f" '$1 == "SKIP" && $2 == f { print $3; exit }' "$TMP_DIR/baseline.res" "$TMP_DIR/fixed.res")
		say "    $f: ${reason:-skipped}"
	done
fi

say "$(printf '%-44s %-10s %-10s' 'test file' 'baseline' 'fixed')"
while IFS= read -r f; do
	[[ -z $f ]] && continue
	b=$(result_of baseline "$f"); x=$(result_of fixed "$f")
	say "$(printf '%-44s %-10s %-10s' "$f" "$b" "$x")"
	# A SKIP never sets the exit status.
	if [[ $x == SKIP || $b == SKIP ]]; then continue; fi
	if [[ $x != PASS && $b == PASS ]]; then EXIT=1; fi
	# New failure = fixed fails and baseline did not also fail.
	if [[ $x == FAIL && $b != FAIL ]]; then EXIT=1; fi
	if [[ $x == MISSING ]]; then EXIT=1; fi
done <<< "$files"

say ""
say "== failures =="
while IFS= read -r f; do
	[[ -z $f ]] && continue
	[[ $(result_of fixed "$f") == FAIL ]] || continue
	say "$f"
	while IFS= read -r line; do
		say "    $line"
	done < <(awk -F'|' -v f="$f" '$1 == "DETAIL" && $2 == f { sub(/^DETAIL\|[^|]*\|/, ""); print }' "$TMP_DIR/fixed.res")
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
