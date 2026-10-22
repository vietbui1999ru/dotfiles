#!/usr/bin/env bash
# firecrawl-setup.sh
# Firecrawl on any machine, CLI first: link the key-loading shim and MCP launcher, install the
# CLI if missing, install its skills with `firecrawl init`, then keep only the curated ones in
# shared/firecrawl-skills.txt. Pruned skills are moved to ~/.agents/skills-disabled, not deleted.
# Called by bootstrap-dirs.sh; safe to re-run.
#
# Usage: ./scripts/firecrawl-setup.sh        (override the repo with DOTFILES=/path)

set -euo pipefail

BASE="${FIRECRAWL_SETUP_HOME:-$HOME}"
DOT="${DOTFILES:-$BASE/dotfiles}"
KEEP_FILE="$DOT/shared/firecrawl-skills.txt"
SKILLS="$BASE/.agents/skills"
DISABLED="$BASE/.agents/skills-disabled"

mkdir -p "$BASE/.local/bin"

# 1. The shim reads FIRECRAWL_API_KEY from ~/secrets/.env so every harness uses one key; the MCP
#    launcher does the same for the MCP server. Both live in the repo and are only linked here.
for tool in firecrawl firecrawl-mcp; do
	ln -sfn "$DOT/scripts/$tool" "$BASE/.local/bin/$tool"
	echo "✓ ~/.local/bin/$tool → $DOT/scripts/$tool"
done

# 2. The real CLI: first firecrawl on PATH that is not the shim.
real_cli() {
	local dir cand
	local IFS=:
	for dir in $PATH; do
		cand="$dir/firecrawl"
		if [[ -x "$cand" && ! "$cand" -ef "$BASE/.local/bin/firecrawl" ]]; then
			printf '%s\n' "$cand"
			return 0
		fi
	done
	return 1
}

if real_cli >/dev/null; then
	echo "✓ firecrawl CLI ($(real_cli))"
elif command -v bun >/dev/null 2>&1; then
	bun add -g firecrawl-cli
	echo "✓ firecrawl CLI installed with bun"
else
	echo "⚠ firecrawl CLI missing and bun not found — install bun, then re-run this script"
	exit 0
fi

# 3. Skills. `firecrawl init` installs every Firecrawl skill and cannot choose, so run it only
#    when a curated skill is missing (or with --refresh), then prune below.
keep=()
while IFS= read -r line; do
	line="${line%%#*}"
	line="${line//[[:space:]]/}"
	[[ -n "$line" ]] && keep+=("$line")
done <"$KEEP_FILE"

is_kept() {
	local n
	for n in "${keep[@]}"; do [[ "$n" == "$1" ]] && return 0; done
	return 1
}

missing=0
[[ "${1:-}" == "--refresh" ]] && missing=1
for name in "${keep[@]}"; do [[ -d "$SKILLS/$name" ]] || missing=1; done
if [[ "$missing" == 1 ]]; then
	# Install per agent: without --agent, init writes skills into the config folder of every agent
	# it knows (Cursor, Gemini, Roo, ...), installed or not. Default is the frontier harnesses;
	# override with FIRECRAWL_AGENTS="claude-code codex opencode ...".
	for agent in ${FIRECRAWL_AGENTS:-claude-code codex opencode}; do
		firecrawl init --yes --skip-install --skip-auth --agent "$agent" </dev/null ||
			echo "⚠ firecrawl init failed for $agent; continuing with what is installed"
	done
fi

# 4. Prune every other firecrawl* skill: move it out of the scanned folder, and drop links to it.
mkdir -p "$DISABLED"
pruned=0
for dir in "$SKILLS"/firecrawl*; do
	[[ -e "$dir" ]] || continue
	name="$(basename "$dir")"
	is_kept "$name" && continue
	rm -rf "${DISABLED:?}/$name"
	mv "$dir" "$DISABLED/$name"
	pruned=$((pruned + 1))
done
# Drop links to pruned or missing skills in the harness folders this setup manages. Other tools'
# folders are never touched here (an earlier run of `firecrawl init` without --agent may have
# left links in them; remove those by hand, they are symlinks into ~/.agents/skills).
for agent in .claude .codex .config/opencode .pi/agent; do
	folder="$BASE/$agent/skills"
	[[ -d "$folder" ]] || continue
	for link in "$folder"/firecrawl*; do
		[[ -L "$link" ]] || continue
		if ! is_kept "$(basename "$link")" || [[ ! -e "$link" ]]; then rm "$link"; fi
	done
done

# 5. Claude Code reads only ~/.claude/skills: point each kept skill at the shared copy.
if [[ -d "$BASE/.claude/skills" ]]; then
	for name in "${keep[@]}"; do
		[[ -d "$SKILLS/$name" ]] || continue
		if [[ -e "$BASE/.claude/skills/$name" && ! -L "$BASE/.claude/skills/$name" ]]; then
			echo "⚠ ~/.claude/skills/$name is a real directory; left as is"
			continue
		fi
		ln -sfn "../../.agents/skills/$name" "$BASE/.claude/skills/$name"
	done
fi
echo "✓ firecrawl skills: ${#keep[@]} kept, $pruned moved to ~/.agents/skills-disabled"
