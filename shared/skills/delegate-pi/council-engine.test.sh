#!/usr/bin/env bash
# council-engine.test.sh — the vendored council engine's diff mode.
#
# Stubbed evaluator through the engine's own seam: no model call, no claude CLI,
# no network. The stub reads the prompt file the engine hands it, so an engine
# that never wrote the diff cannot pass these cases by accident, and it records
# every call so a test can assert the seam was, or was not, dispatched.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
engine=$here/council
wrapper=$here/pi-council.sh
tmp=$(mktemp -d "${TMPDIR:-/tmp}/council-engine.XXXXXX") || exit 1
trap 'rm -rf "$tmp"' EXIT

failures=0
check() { # check <description> <actual> <expected>
	if [ "$2" = "$3" ]; then
		printf 'ok   %s\n' "$1"
	else
		printf 'FAIL %s: expected %q, got %q\n' "$1" "$3" "$2"
		failures=$((failures + 1))
	fi
}

cat >"$tmp/sample.diff" <<'EOF'
--- a/example.sh
+++ b/example.sh
@@ -1 +1 @@
-echo old
+echo new
EOF

# The stubbed evaluator. STUB_VOTES maps dimension -> what it prints:
#   PASS|FAIL  a clean vote line
#   EXIT       exit non-zero (no vote)
#   GARBAGE    exit 0 with no clean `VOTE:` line
#   (anything else, including an absent row) exit 0 printing nothing
cat >"$tmp/evaluator" <<'EOF'
#!/usr/bin/env bash
prompt=$1 dim=$2
[ -s "$prompt" ] || exit 1
printf '%s\n' "$dim" >>"$STUB_CALLS"
printf 'REASON: stub %s voice\n' "$dim"
vote=$(awk -v d="$dim" '$1 == d { print $2; exit }' "$STUB_VOTES")
case "$vote" in
PASS | FAIL) printf 'VOTE: %s\n' "$vote" ;;
EXIT) exit 3 ;;
GARBAGE) printf 'Looks fine to me.\n' ;;
*) : ;;
esac
EOF
chmod +x "$tmp/evaluator"

votes() { printf '%s\n' "$@" >"$tmp/votes"; }
run_engine() { # run_engine <stdin-file>
	STUB_VOTES=$tmp/votes STUB_CALLS=$tmp/calls \
		COUNCIL_EVALUATOR_CMD=$tmp/evaluator "$engine" --diff - <"$1"
}
calls() { [ -f "$tmp/calls" ] && wc -l <"$tmp/calls" | tr -d ' ' || printf 0; }
reset_calls() { rm -f "$tmp/calls"; }

printf 'three PASS votes give verdict PASS\n'
reset_calls
votes 'acceptance-criteria PASS' 'code-quality PASS' 'style PASS'
out=$(run_engine "$tmp/sample.diff")
check 'verdict is PASS' "$(jq -r '.verdict' <<<"$out" 2>/dev/null)" PASS
check 'mode is diff' "$(jq -r '.mode' <<<"$out" 2>/dev/null)" diff
check 'three votes are reported' "$(jq -r '.votes | length' <<<"$out" 2>/dev/null)" 3
check 'dimensions are in order' \
	"$(jq -r '[.votes[].dimension] | join(",")' <<<"$out" 2>/dev/null)" \
	acceptance-criteria,code-quality,style
check 'the reasons are kept' \
	"$(jq -r '[.votes[].reason | length > 0] | all' <<<"$out" 2>/dev/null)" true
check 'the seam was dispatched once per dimension' "$(calls)" 3

printf 'one PASS and two FAIL give verdict FAIL\n'
reset_calls
votes 'acceptance-criteria PASS' 'code-quality FAIL' 'style FAIL'
out=$(run_engine "$tmp/sample.diff")
check 'verdict is FAIL' "$(jq -r '.verdict' <<<"$out" 2>/dev/null)" FAIL
check 'one PASS vote' \
	"$(jq -r '[.votes[] | select(.vote == "PASS")] | length' <<<"$out" 2>/dev/null)" 1
check 'two FAIL votes' \
	"$(jq -r '[.votes[] | select(.vote == "FAIL")] | length' <<<"$out" 2>/dev/null)" 2

printf 'a non-zero exit or an unreadable answer is an ABSTAIN\n'
reset_calls
votes 'acceptance-criteria EXIT' 'code-quality GARBAGE' 'style PASS'
out=$(run_engine "$tmp/sample.diff")
check 'non-zero exit abstains' \
	"$(jq -r '.votes[] | select(.dimension == "acceptance-criteria") | .vote' <<<"$out" 2>/dev/null)" \
	ABSTAIN
check 'no clean VOTE line abstains' \
	"$(jq -r '.votes[] | select(.dimension == "code-quality") | .vote' <<<"$out" 2>/dev/null)" \
	ABSTAIN
check 'the readable vote still counts' \
	"$(jq -r '.votes[] | select(.dimension == "style") | .vote' <<<"$out" 2>/dev/null)" PASS
check 'one PASS of three is a FAIL verdict' "$(jq -r '.verdict' <<<"$out" 2>/dev/null)" FAIL

printf 'three abstentions give verdict FAIL\n'
reset_calls
votes 'acceptance-criteria EXIT' 'code-quality GARBAGE' 'style EXIT'
out=$(run_engine "$tmp/sample.diff")
check 'verdict is FAIL' "$(jq -r '.verdict' <<<"$out" 2>/dev/null)" FAIL
check 'three ABSTAIN votes' \
	"$(jq -r '[.votes[] | select(.vote == "ABSTAIN")] | length' <<<"$out" 2>/dev/null)" 3

printf 'an empty diff fails safe without dispatching the evaluator\n'
reset_calls
votes 'acceptance-criteria PASS' 'code-quality PASS' 'style PASS'
: >"$tmp/empty.diff"
out=$(run_engine "$tmp/empty.diff")
check 'verdict is FAIL' "$(jq -r '.verdict' <<<"$out" 2>/dev/null)" FAIL
check 'three ABSTAIN votes' \
	"$(jq -r '[.votes[] | select(.vote == "ABSTAIN")] | length' <<<"$out" 2>/dev/null)" 3
check 'the evaluator was never called' "$(calls)" 0

printf 'a range git cannot resolve exits 1 with nothing on stdout\n'
reset_calls
votes 'acceptance-criteria PASS' 'code-quality PASS' 'style PASS'
STUB_VOTES=$tmp/votes STUB_CALLS=$tmp/calls COUNCIL_EVALUATOR_CMD=$tmp/evaluator \
	"$engine" --diff 'no-such-ref-zzz..HEAD' >"$tmp/out" 2>"$tmp/err"
check 'exit status is 1' "$?" 1
check 'stdout is empty' "$(wc -c <"$tmp/out" | tr -d ' ')" 0
check 'the failure is reported on stderr' \
	"$(grep -c 'cannot resolve diff range' "$tmp/err")" 1

printf 'wrong arguments exit 2\n'
"$engine" >/dev/null 2>&1
check 'no arguments exits 2' "$?" 2
"$engine" --diff >/dev/null 2>&1
check 'a missing range exits 2' "$?" 2
"$engine" --diff a b >/dev/null 2>&1
check 'a surplus argument exits 2' "$?" 2

printf 'pi-council.sh with COUNCIL_CMD unset finds the vendored engine\n'
reset_calls
votes 'acceptance-criteria PASS' 'code-quality PASS' 'style PASS' 'security PASS'
out=$(env -u COUNCIL_CMD STUB_VOTES="$tmp/votes" STUB_CALLS="$tmp/calls" \
	COUNCIL_EVALUATOR_CMD="$tmp/evaluator" COUNCIL_SECURITY_EVALUATOR_CMD="$tmp/evaluator" \
	"$wrapper" --diff - <"$tmp/sample.diff")
check 'verdict is PASS' "$(jq -r '.verdict' <<<"$out" 2>/dev/null)" PASS
check 'mode is diff' "$(jq -r '.mode' <<<"$out" 2>/dev/null)" diff
check 'four voices, the veto last' "$(jq -r '.votes | length' <<<"$out" 2>/dev/null)" 4
check 'the security veto voted' \
	"$(jq -r '.votes[] | select(.dimension == "security") | .vote' <<<"$out" 2>/dev/null)" PASS
check 'the engine and the veto each dispatched' "$(calls)" 4

if [ "$failures" -ne 0 ]; then
	printf '\n%s failed\n' "$failures" >&2
	exit 1
fi
printf '\nall checks passed\n'
