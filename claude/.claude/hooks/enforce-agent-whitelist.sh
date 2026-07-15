#!/usr/bin/env bash
# PreToolUse hook — enforces agent routing rules.
# Code repos: strict whitelist, no generic agents.
# Non-code contexts: general-purpose and claude agents allowed.
# Exit 0 = allow. Exit 2 = block (stdout shown as block reason).

INPUT=$(cat)

SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""' 2>/dev/null)
MODEL=$(echo "$INPUT" | jq -r '.tool_input.model // ""' 2>/dev/null)

# Detect code repo: build/package files (fast) or source file scan (fallback)
is_code_repo() {
  local cwd="${PWD}"
  for f in package.json Cargo.toml go.mod pyproject.toml setup.py CMakeLists.txt pom.xml build.gradle; do
    [ -f "${cwd}/${f}" ] && return 0
  done
  find "${cwd}" -maxdepth 3 \
    \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
       -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.kt" \
       -o -name "*.cpp" -o -name "*.c" -o -name "*.swift" -o -name "*.cs" \) \
    -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" \
    -quit 2>/dev/null | grep -q .
}

# Compute once — avoids repeated find scans
CODE_REPO=0
is_code_repo && CODE_REPO=1

# Agents allowed in any context (not just whitelisted ones)
GENERIC_AGENTS=("general-purpose" "claude")

# No subagent_type = would default to general-purpose
if [ -z "$SUBAGENT_TYPE" ]; then
  if [ "$CODE_REPO" -eq 0 ]; then
    # Allow implicit general-purpose outside code repos; model check still applies below
    SUBAGENT_TYPE="general-purpose"
  else
    >&2 echo "BLOCKED: Agent called without subagent_type — defaults to 'general-purpose', banned in code repos."
    >&2 echo "Specify a configured agent from ~/.claude/agents/ or an approved plugin agent."
    exit 2
  fi
fi

# Model param always required — forces conscious routing per model-routing.md
if [ -z "$MODEL" ]; then
  >&2 echo "BLOCKED: Agent spawn for '$SUBAGENT_TYPE' missing explicit model param."
  >&2 echo "  haiku  — single-step mechanical: lookups, boilerplate, bounded subagent work"
  >&2 echo "  sonnet — multi-file impl, review, debugging, standard orchestration"
  >&2 echo "  opus   — architecture, security audits, irreversible ops, hard bugs"
  >&2 echo "  fable  — explicitly requested by name"
  exit 2
fi

# Two accepted spellings, because two layers consume this value:
#   - the Agent tool's model enum takes bare tier aliases
#   - agent frontmatter and settings.json also accept concrete versioned IDs
# Both resolve to the same model, so validate the shape rather than a fixed list —
# a hardcoded alias list rejects every real model ID (e.g. claude-haiku-4-5).
MODEL_BASE="${MODEL%\[1m\]}"                       # strip optional [1m] context suffix
MODEL_FAMILY=""
case "$MODEL_BASE" in
  haiku|sonnet|opus|fable|inherit) MODEL_FAMILY="$MODEL_BASE" ;;
  claude-*)
    if [[ "$MODEL_BASE" =~ ^claude-(haiku|sonnet|opus|fable|mythos)-[0-9]+(-[0-9]+)?(-[0-9]{8})?$ ]]; then
      MODEL_FAMILY="${BASH_REMATCH[1]}"
    fi
    ;;
esac

if [ -z "$MODEL_FAMILY" ]; then
  >&2 echo "BLOCKED: model '$MODEL' is not a recognized model."
  >&2 echo "  Tier alias:  haiku | sonnet | opus | fable | inherit"
  >&2 echo "  Versioned:   claude-<family>-<version>[-<date>]  (e.g. claude-haiku-4-5)"
  exit 2
fi

# Outside code repos: generic agents are fine
if [ "$CODE_REPO" -eq 0 ]; then
  for ga in "${GENERIC_AGENTS[@]}"; do
    [ "$SUBAGENT_TYPE" = "$ga" ] && exit 0
  done
fi

# Build whitelist from ~/.claude/agents/*.md
AGENTS_DIR="$HOME/.claude/agents"
declare -A WHITELIST

if [ -d "$AGENTS_DIR" ]; then
  for file in "$AGENTS_DIR"/*.md; do
    [ -f "$file" ] || continue
    WHITELIST["$(basename "$file" .md)"]=1
  done
fi

PLUGIN_AGENTS=(
  "feature-dev:code-architect"
  "feature-dev:code-explorer"
  "feature-dev:code-reviewer"
  "code-simplifier:code-simplifier"
  "agent-sdk-dev:agent-sdk-verifier-py"
  "agent-sdk-dev:agent-sdk-verifier-ts"
  "claude-code-guide"
  "Explore"
  "Plan"
  "statusline-setup"
)
for pa in "${PLUGIN_AGENTS[@]}"; do WHITELIST["$pa"]=1; done

if [ "${WHITELIST[$SUBAGENT_TYPE]+_}" ]; then
  exit 0
fi

# Block with context-aware message
CTX="code repo — strict mode"
[ "$CODE_REPO" -eq 0 ] && CTX="non-code context"

ALLOWED=$(printf '%s\n' "${!WHITELIST[@]}" | sort | tr '\n' ', ' | sed 's/,$//')
>&2 echo "BLOCKED ($CTX): Agent type '$SUBAGENT_TYPE' is not configured."
>&2 echo "Allowed: $ALLOWED"
if [ "$CODE_REPO" -eq 0 ]; then
  >&2 echo "Also allowed here (non-code): ${GENERIC_AGENTS[*]}"
fi
exit 2
