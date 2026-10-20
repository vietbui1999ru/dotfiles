#!/opt/homebrew/bin/bash
# Regression: a run that loses the balance lock marks dirty; the holder must
# launch one fresh measurement after releasing the lock.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

cat >"$TMP/bin/sketchybar" <<'EOF'
#!/opt/homebrew/bin/bash
set -euo pipefail
printf '%s\n' "$*" >>"$MOCK_LOG"
if [[ "$1" == "--query" ]]; then
  # Hold the balance lock long enough for the second invocation to lose it.
  sleep 0.2
  if [[ "$2" == "left_pill" ]]; then
    echo '{"bounding_rects":{"left":{"size":[300,37]}}}'
  else
    echo '{"bounding_rects":{"right":{"size":[200,37]}}}'
  fi
fi
EOF
chmod +x "$TMP/bin/sketchybar"

export PATH="$TMP/bin:$PATH"
export TMPDIR="$TMP"
export MOCK_LOG="$TMP/mock.log"

"$ROOT/balance_pills.sh" &
first=$!
sleep 0.2
"$ROOT/balance_pills.sh" &
second=$!
wait "$first" "$second"
# The holder's dirty rerun is backgrounded: poll (bounded, 10s) until it has
# measured and released the lock, rather than guessing how long it takes.
# One run issues 4 queries (2 spacers + 2 pills), so the rerun means >= 8.
for _ in $(seq 100); do
  queries=$(grep -c '^--query ' "$MOCK_LOG" || true)
  (( queries >= 8 )) && [[ ! -e "$TMP/sketchybar_balance.lock" ]] && break
  sleep 0.1
done

[[ "$queries" -ge 8 ]]
[[ ! -e "$TMP/sketchybar_balance.lock" ]]
[[ ! -e "$TMP/sketchybar_balance.dirty" ]]
printf 'balance contention: %s query measurements, dirty rerun completed\n' "$queries"
