#!/usr/bin/env bash
# Pi model router. Keeps caller stdout clean by exec'ing pi directly.

set -euo pipefail

mode="${1:?usage: pi-router.sh <mode> <selector> [pi-args...] }"
selector="${2:?usage: pi-router.sh <mode> <selector> [pi-args...] }"
shift 2

routing_file="${PI_ROUTING_FILE:-$HOME/.pi/agent/routing.env}"
if [ -r "$routing_file" ]; then
  # User-owned config. Keep values simple KEY=value shell assignments.
  # shellcheck disable=SC1090
  . "$routing_file"
fi

model=""
case "$mode:$selector" in
  council:acceptance-criteria)
    model="${PI_COUNCIL_ACCEPTANCE_MODEL:-${PI_COUNCIL_DEFAULT_MODEL:-${PI_MODEL:-}}}"
    ;;
  council:code-quality)
    model="${PI_COUNCIL_CODE_QUALITY_MODEL:-${PI_COUNCIL_DEFAULT_MODEL:-${PI_MODEL:-}}}"
    ;;
  council:style)
    model="${PI_COUNCIL_STYLE_MODEL:-${PI_COUNCIL_DEFAULT_MODEL:-${PI_MODEL:-}}}"
    ;;
  delegate:high)
    model="${PI_DELEGATE_HIGH_MODEL:-${PI_MODEL:-}}"
    ;;
  delegate:medium)
    model="${PI_DELEGATE_MEDIUM_MODEL:-${PI_MODEL:-}}"
    ;;
  delegate:low)
    model="${PI_DELEGATE_LOW_MODEL:-${PI_MODEL:-}}"
    ;;
  *)
    model="${PI_MODEL:-}"
    ;;
esac

cmd=(pi)
if [ -n "$model" ]; then
  cmd+=(--model "$model")
fi

exec "${cmd[@]}" "$@"
