#!/usr/bin/env bash
# PreToolUse hook — blocks Claude from editing lint config files.
# Prevents Claude from writing rule exceptions for itself.
# Always-on globally — does not require linting: enabled.

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
[ -z "$FILE" ] && exit 0

BASENAME=$(basename "$FILE")

PROTECTED=(
  "biome.json"
  "biome.jsonc"
  "eslint.config.js"
  "eslint.config.mjs"
  "eslint.config.cjs"
  ".eslintrc"
  ".eslintrc.js"
  ".eslintrc.json"
  ".eslintrc.yml"
  ".eslintrc.yaml"
  ".noslop"
  ".golangci.yml"
  ".golangci.yaml"
  "checkstyle.xml"
  ".rubocop.yml"
  "detekt.yml"
  ".swiftlint.yml"
  "phpstan.neon"
  "phpmd.xml"
  ".luacheckrc"
  ".hlint.yaml"
  ".credo.exs"
  "analysis_options.yaml"
)

for protected in "${PROTECTED[@]}"; do
  if [[ "$BASENAME" == "$protected" ]]; then
    echo "BLOCKED: '$BASENAME' is a protected lint config."
    echo "Claude cannot modify lint configs — this prevents rule exceptions being written."
    echo "Make changes manually outside Claude Code."
    exit 2
  fi
done

exit 0
