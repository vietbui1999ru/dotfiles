#!/usr/bin/env bash
# Test sync-upstream: match exits 0, drift exits 1 with a diff, missing upstream exits 2.

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SYNC="${SCRIPT_DIR}/../sync-upstream"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/sync-upstream-test.XXXXXX")
trap 'rm -rf "${TMP}"' EXIT

UP="${TMP}/upstream.md"
MP="${TMP}/marketplace.md"

fail() { echo "FAIL: $*" >&2; exit 1; }

# Case 1: match -> 0
printf 'same content\n' > "${UP}"
printf 'same content\n' > "${MP}"
bash "${SYNC}" "${UP}" "${MP}"
RC=$?
[[ ${RC} -eq 0 ]] || fail "match expected exit 0, got ${RC}"

# Case 2: drift -> 1 and prints a diff mentioning the divergent line
printf 'pinned line\n' > "${UP}"
printf 'marketplace line\n' > "${MP}"
OUT=$(bash "${SYNC}" "${UP}" "${MP}" 2>&1)
RC=$?
[[ ${RC} -eq 1 ]] || fail "drift expected exit 1, got ${RC}"
[[ "${OUT}" == *"pinned line"* ]] || fail "drift should print a diff; got: ${OUT}"

# Case 3: missing upstream -> 2
OUT=$(bash "${SYNC}" "${TMP}/does-not-exist.md" "${MP}" 2>&1)
RC=$?
[[ ${RC} -eq 2 ]] || fail "missing upstream expected exit 2, got ${RC}"

echo "sync-upstream: match/drift/missing all pass"
