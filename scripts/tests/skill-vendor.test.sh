#!/usr/bin/env bash
# skill-vendor.test.sh <check|audit> — tests for scripts/skill-vendor.
set -u

CASE="${1:?usage: skill-vendor.test.sh <check|audit>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../skill-vendor"
FIXTURES="$HERE/fixtures/skill-vendor"
STUB="$FIXTURES/gh-stub.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "skill-vendor $CASE: FAIL: $*" >&2
  exit 1
}

# Run check against a vendor.json; sets RC and OUT.
run_check() {
  local vendor="$1"
  OUT="$(SKILL_VENDOR_GH="$STUB" "$SCRIPT" check --vendor "$vendor" 2>&1)"
  RC=$?
  case "$OUT" in
    *Traceback*) fail "traceback in output: $OUT" ;;
  esac
}

case "$CASE" in
check)
  ROOT="$TMP/skills"
  mkdir -p "$ROOT/alpha" "$ROOT/beta" "$ROOT/gamma"
  printf 'local alpha\n' > "$ROOT/alpha/SKILL.md"
  printf 'local beta\n' > "$ROOT/beta/SKILL.md"
  printf 'local beta upstream\nold line\n' > "$ROOT/beta/upstream.md"
  printf 'local gamma\n' > "$ROOT/gamma/SKILL.md"
  SHA=abc123
  VENDOR="$ROOT/vendor.json"
  cat > "$VENDOR" <<EOF
{"skills":[
  {"name":"alpha","upstream":{"repo":"o/r","path":"skills/alpha/SKILL.md","sha":"$SHA"},"notes":"n"},
  {"name":"beta","upstream":{"repo":"o/r","path":"skills/beta/SKILL.md","sha":"$SHA"},"notes":"n"},
  {"name":"gamma","status":"frozen","upstream":{"repo":"o/r","path":"skills/gamma/SKILL.md","sha":"$SHA"},"notes":"n"}
]}
EOF

  # Upstream unchanged: alpha and beta in sync; gamma frozen so gh is never called for it.
  LOG="$TMP/calls.log"
  : > "$LOG"
  export SKILL_VENDOR_STUB_CHANGED='["docs/other.md"]' SKILL_VENDOR_STUB_LOG="$LOG"
  unset SKILL_VENDOR_STUB_FAIL
  run_check "$VENDOR"
  [ "$RC" -eq 0 ] || fail "in sync expected exit 0, got $RC: $OUT"
  case "$OUT" in *"alpha: in sync"*) ;; *) fail "alpha not in sync: $OUT" ;; esac
  case "$OUT" in *"gamma: frozen (skipped)"*) ;; *) fail "gamma not skipped: $OUT" ;; esac
  if grep -q 'gamma' "$LOG"; then
    fail "gh was called for the frozen entry: $(cat "$LOG")"
  fi

  # Upstream drifted: beta's path is in the compare list, with upstream content to diff.
  export SKILL_VENDOR_STUB_CHANGED='["skills/beta/SKILL.md"]'
  UPSTREAM_B64="$(printf 'new upstream line\nold line\n' | base64)"
  export SKILL_VENDOR_STUB_CONTENT="$UPSTREAM_B64"
  run_check "$VENDOR"
  [ "$RC" -eq 1 ] || fail "drift expected exit 1, got $RC: $OUT"
  case "$OUT" in *"beta: drifted"*) ;; *) fail "beta not drifted: $OUT" ;; esac
  printf '%s\n' "$OUT" | grep -Eq '^[+-][^+-]' || fail "no diff line in output: $OUT"

  # Missing SKILL.md: pin missing.
  rm "$ROOT/alpha/SKILL.md"
  run_check "$VENDOR"
  [ "$RC" -eq 2 ] || fail "missing SKILL.md expected exit 2, got $RC: $OUT"
  case "$OUT" in *"alpha: pin missing"*) ;; *) fail "alpha pin missing not reported: $OUT" ;; esac
  printf 'local alpha\n' > "$ROOT/alpha/SKILL.md"

  # Entry without sha: pin missing.
  cat > "$ROOT/nosha.json" <<'EOF'
{"skills":[{"name":"alpha","upstream":{"repo":"o/r","path":"skills/alpha/SKILL.md"},"notes":"n"}]}
EOF
  run_check "$ROOT/nosha.json"
  [ "$RC" -eq 2 ] || fail "missing sha expected exit 2, got $RC: $OUT"
  case "$OUT" in *"pin missing"*) ;; *) fail "missing sha not reported: $OUT" ;; esac

  # gh failure: error, exit 2, no traceback.
  export SKILL_VENDOR_STUB_FAIL="HTTP 404: Not Found"
  run_check "$VENDOR"
  [ "$RC" -eq 2 ] || fail "gh failure expected exit 2, got $RC: $OUT"
  case "$OUT" in *"error (HTTP 404"*) ;; *) fail "gh failure not reported: $OUT" ;; esac
  ;;

audit)
  HOME_DIR="$TMP/home"
  PLUGIN_KEY="fake@market"
  PLUGIN_DIR="$TMP/plugins/fake"
  mkdir -p "$HOME_DIR/.claude/skills/used-skill" "$HOME_DIR/.claude/skills/old-skill" \
           "$HOME_DIR/.claude/plugins" "$HOME_DIR/.claude/projects/proj"
  # Broken symlink must still count as a candidate.
  ln -s "$TMP/does-not-exist" "$HOME_DIR/.claude/skills/broken-link"
  mkdir -p "$PLUGIN_DIR"
  cp -R "$FIXTURES/plugin/." "$PLUGIN_DIR/"

  cat > "$HOME_DIR/.claude/settings.json" <<EOF
{"enabledPlugins":{"$PLUGIN_KEY":true,"off@market":false}}
EOF
  cat > "$HOME_DIR/.claude/plugins/installed_plugins.json" <<EOF
{"version":2,"plugins":{"$PLUGIN_KEY":[{"scope":"user","installPath":"$PLUGIN_DIR"}],"off@market":[{"installPath":"$TMP/nope"}]}}
EOF

  NOW_ISO="$(python3 -c 'from datetime import datetime,timezone;print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
  OLD_ISO="$(python3 -c 'from datetime import datetime,timedelta,timezone;print((datetime.now(timezone.utc)-timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
  cat > "$HOME_DIR/.claude/projects/proj/session.jsonl" <<EOF
{"type":"assistant","timestamp":"$NOW_ISO","message":{"role":"assistant","content":[{"type":"tool_use","name":"Skill","input":{"skill":"used-skill"}}]}}
this line is not json at all
{"type":"assistant","timestamp":"$OLD_ISO","message":{"role":"assistant","content":[{"type":"tool_use","name":"Skill","input":{"skill":"old-skill"}}]}}
EOF

  JSON="$(SKILL_VENDOR_GH="$STUB" "$SCRIPT" audit --json --home "$HOME_DIR" --days 60 2>"$TMP/err")" \
    || fail "audit exited non-zero: $(cat "$TMP/err")"
  printf '%s' "$JSON" > "$TMP/out.json"

  jq -e '[.unused_skills[].name] == ["broken-link","fake:p-skill","old-skill"]' "$TMP/out.json" >/dev/null \
    || fail "unused_skills wrong: $(jq -c '.unused_skills' "$TMP/out.json")"
  jq -e '.unused_skills[] | select(.name=="old-skill") | .last_used != null' "$TMP/out.json" >/dev/null \
    || fail "old-skill last_used should be set"
  jq -e --arg k "$PLUGIN_KEY" '.session_start_bytes[$k] == 5' "$TMP/out.json" >/dev/null \
    || fail "session_start_bytes wrong: $(jq -c '.session_start_bytes' "$TMP/out.json")"
  jq -e --arg k "$PLUGIN_KEY" '.hooks[$k].SessionStart == 1 and .hooks[$k].PostToolUse == 1' "$TMP/out.json" >/dev/null \
    || fail "hooks wrong: $(jq -c '.hooks' "$TMP/out.json")"
  jq -e '.errors == []' "$TMP/out.json" >/dev/null || fail "unexpected errors: $(jq -c '.errors' "$TMP/out.json")"
  ;;

*)
  echo "usage: skill-vendor.test.sh <check|audit>" >&2
  exit 2
  ;;
esac

echo "skill-vendor $CASE: ok"
