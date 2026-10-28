#!/usr/bin/env bash
# pi-council.sh — the delegate-pi council: bin/council's three voices plus a
# security/correctness veto voice.
#
#   pi-council.sh --diff HEAD
#   pi-council.sh --diff main...HEAD
#   git diff main...HEAD | pi-council.sh --diff -
#
# The three voices, their dimensions and the majority rule are bin/council's
# (COUNCIL-5, COUNCIL-8); this wrapper only adds a fourth, after the engine has
# voted. Each voice is one Pi call through pi-router.sh: the engine's three are
# acceptance-criteria, code-quality and style, and the veto is `council:security`
# (PI_COUNCIL_SECURITY_MODEL). A FAIL from the security voice turns the verdict
# to FAIL; a PASS, or an answer that cannot be read as a vote, leaves the
# three-voice verdict as it is.
#
# Output is the engine's JSON object with the security vote appended to votes,
# so `.verdict` stays the one field to read.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
engine=${COUNCIL_CMD:-council}
three=${COUNCIL_EVALUATOR_CMD:-$here/pi-evaluator.sh}
security=${COUNCIL_SECURITY_EVALUATOR_CMD:-$here/pi-evaluator.sh}

usage() {
	printf 'usage: pi-council.sh --diff <ref-range>|-\n' >&2
	exit 2
}

[ "$#" -eq 2 ] && [ "$1" = --diff ] || usage

work=$(mktemp -d "${TMPDIR:-/tmp}/pi-council.XXXXXX") || exit 1
trap 'rm -rf "$work"' EXIT

# Capture the diff once: the engine and the veto voice both read the same text,
# and stdin cannot be read twice.
diff=$work/diff.txt
if [ "$2" = - ]; then
	cat >"$diff"
else
	git diff "$2" >"$diff" 2>/dev/null ||
		{ printf 'pi-council: cannot resolve diff range: %s\n' "$2" >&2; exit 1; }
fi

verdict=$(COUNCIL_EVALUATOR_CMD=$three "$engine" --diff - <"$diff")

# The veto voice. Its answer follows the evaluator seam: exit 0 and a clean
# `VOTE: PASS|FAIL` line, with an optional `REASON:` line.
vote=ABSTAIN
reason=""
if [ -s "$diff" ]; then
	out=$("$security" "$diff" security 2>/dev/null) || out=""
	if [ -n "$out" ]; then
		vote=$(grep -m1 -E '^VOTE: (PASS|FAIL)$' <<<"$out" | awk '{print $2}')
		[ -n "$vote" ] || vote=ABSTAIN
		reason=$(grep -m1 '^REASON: ' <<<"$out" | sed 's/^REASON: //')
	fi
fi

if ! jq -e 'type == "object" and (.verdict == "PASS" or .verdict == "FAIL") and (.votes | type) == "array"' \
	<<<"$verdict" >/dev/null 2>&1; then
	printf 'pi-council: council engine returned no verdict\n' >&2
	exit 1
fi

# The veto, then the vote appended: `.verdict` is the one field callers read.
jq --arg vote "$vote" --arg reason "$reason" '
	.verdict = (if $vote == "FAIL" then "FAIL" else .verdict end)
	| .votes += [{dimension: "security", vote: $vote, reason: $reason}]
' <<<"$verdict"
