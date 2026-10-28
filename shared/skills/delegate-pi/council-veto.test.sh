#!/usr/bin/env bash
# council-veto.test.sh — the security veto in pi-council.sh.
#
# Stubbed engine and stubbed security voice: no model call, no herdr, no network.
# The stub voice reads the diff prompt file, so a wrapper that failed to hand the
# diff over cannot pass these cases by accident.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
wrapper=$here/pi-council.sh
tmp=$(mktemp -d "${TMPDIR:-/tmp}/council-veto.XXXXXX") || exit 1
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

# The three-voice engine, stubbed: three PASS votes, verdict PASS.
cat >"$tmp/engine" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf '%s\n' '{"mode":"diff","verdict":"PASS","votes":[{"dimension":"acceptance-criteria","vote":"PASS","reason":"meets the ACs"},{"dimension":"code-quality","vote":"PASS","reason":"sound"},{"dimension":"style","vote":"PASS","reason":"consistent"}]}'
EOF

# Security voice stubs: they fail unless the wrapper hands over the diff.
cat >"$tmp/security-fail" <<'EOF'
#!/usr/bin/env bash
[ -s "$1" ] || exit 1
printf 'VOTE: FAIL\nREASON: %s voice: unsanitised input reaches the shell\n' "$2"
EOF
cat >"$tmp/security-pass" <<'EOF'
#!/usr/bin/env bash
[ -s "$1" ] || exit 1
printf 'VOTE: PASS\nREASON: %s voice: no security or correctness defect in the diff\n' "$2"
EOF
chmod +x "$tmp/engine" "$tmp/security-fail" "$tmp/security-pass"

printf 'security FAIL vetoes a council that would otherwise pass\n'
out=$(COUNCIL_CMD=$tmp/engine COUNCIL_SECURITY_EVALUATOR_CMD=$tmp/security-fail \
	"$wrapper" --diff - <"$tmp/sample.diff")
check 'verdict is FAIL' "$(jq -r '.verdict' <<<"$out" 2>/dev/null)" FAIL
check 'security vote is FAIL' \
	"$(jq -r '.votes[] | select(.dimension == "security") | .vote' <<<"$out" 2>/dev/null)" FAIL
check 'security reason is kept' \
	"$(jq -r '.votes[] | select(.dimension == "security") | .reason | length > 0' <<<"$out" 2>/dev/null)" true
check 'the three voices still vote PASS' \
	"$(jq -r '[.votes[] | select(.dimension != "security") | .vote] | unique | join(",")' <<<"$out" 2>/dev/null)" PASS
check 'four votes are reported' "$(jq -r '.votes | length' <<<"$out" 2>/dev/null)" 4

printf 'security PASS leaves the three-voice verdict as it is\n'
out=$(COUNCIL_CMD=$tmp/engine COUNCIL_SECURITY_EVALUATOR_CMD=$tmp/security-pass \
	"$wrapper" --diff - <"$tmp/sample.diff")
check 'verdict is PASS' "$(jq -r '.verdict' <<<"$out" 2>/dev/null)" PASS
check 'security vote is PASS' \
	"$(jq -r '.votes[] | select(.dimension == "security") | .vote' <<<"$out" 2>/dev/null)" PASS
check 'four votes are reported' "$(jq -r '.votes | length' <<<"$out" 2>/dev/null)" 4

if [ "$failures" -ne 0 ]; then
	printf '\n%s failed\n' "$failures" >&2
	exit 1
fi
printf '\nall checks passed\n'
