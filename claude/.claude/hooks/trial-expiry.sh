#!/usr/bin/env bash
# SessionStart hook — report expired trial artifacts and core-budget pressure.
# Never deletes or promotes anything; both remain human decisions.

set -euo pipefail

TRIAL_DIR="$HOME/.claude/trial"
MANIFEST="$TRIAL_DIR/manifest.json"
USAGE_COUNTER="$HOME/dotfiles/scripts/trial-usage.sh"
SKILLS_DIR="$HOME/.claude/skills"
AGENTS_DIR="$HOME/.claude/agents"
RULES_FILE="$HOME/.claude/CLAUDE.md"
SETTINGS_FILE="$HOME/.claude/settings.json"
TODAY=$(date -u +%F)

usage_total() {
	local name="$1"
	[[ -x "$USAGE_COUNTER" ]] || { echo "?"; return; }
	"$USAGE_COUNTER" "$name" 2>/dev/null |
		awk -F': ' '$1 == "total" { print $2; found = 1 } END { if (!found) print "?" }'
}

count_skill_dirs() {
	[[ -d "$SKILLS_DIR" ]] || { echo 0; return; }
	find -L "$SKILLS_DIR" -mindepth 1 -maxdepth 1 -type d ! -name trial 2>/dev/null | wc -l | tr -d ' '
}

count_agent_files() {
	[[ -d "$AGENTS_DIR" ]] || { echo 0; return; }
	find "$AGENTS_DIR" -mindepth 1 -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' '
}

count_loaded_rules() {
	[[ -f "$RULES_FILE" ]] || { echo 0; return; }
	grep -c '^@~/.claude/rules/.*\.md' "$RULES_FILE" 2>/dev/null || true
}

count_hook_commands() {
	[[ -f "$SETTINGS_FILE" ]] || { echo 0; return; }
	jq '[.hooks // {} | to_entries[] | .value[]? | .hooks[]?] | length' "$SETTINGS_FILE" 2>/dev/null || echo 0
}

expired=()
if [[ -f "$MANIFEST" ]] && jq -e 'type == "array"' "$MANIFEST" >/dev/null 2>&1; then
	while IFS=$'\t' read -r name kind path; do
		[[ -n "$name" ]] || continue
		expired+=("$name ($(usage_total "$name") uses)")
	done < <(
		jq -r --arg today "$TODAY" '
			.[] | select(
				(.name | type == "string") and
				(.kind | type == "string") and
				(.path | type == "string") and
				(.expires | type == "string") and
				(.expires <= $today)
			) | [.name, .kind, .path] | @tsv
		' "$MANIFEST"
	)
elif [[ -f "$MANIFEST" ]]; then
	echo "trial manifest is invalid; expected a JSON array: $MANIFEST" >&2
fi

skills=$(count_skill_dirs)
agents=$(count_agent_files)
rules=$(count_loaded_rules)
hooks=$(count_hook_commands)
over_budget=false
(( skills > 11 || agents > 2 || rules > 4 || hooks > 5 )) && over_budget=true

if (( ${#expired[@]} > 0 )) || [[ "$over_budget" == true ]]; then
	if (( ${#expired[@]} > 0 )); then
		printf '%s trial artifacts expired: %s.\n' "${#expired[@]}" "$(IFS=', '; echo "${expired[*]}")"
	fi
	printf 'Core budget: skills %s/11, agents %s/2, rules %s/4, hooks %s/5.\n' \
		"$skills" "$agents" "$rules" "$hooks"
fi
