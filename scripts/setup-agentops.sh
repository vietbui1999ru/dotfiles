#!/usr/bin/env bash
# setup-agentops.sh — Idempotent AgentOps vault bootstrap
#
# Creates or repairs the AgentOps Obsidian vault at $AGENTOPS_VAULT.
# Safe to re-run — detects existing setup and skips/materializes as needed.
#
# Usage:
#   ./scripts/setup-agentops.sh                        # full setup
#   ./scripts/setup-agentops.sh --repair               # plugin guard only
#   ./scripts/setup-agentops.sh --status               # check + report
#
# See docs/SETUP-obsidian-gittui.md for full setup walkthrough.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES="$(dirname "$SCRIPT_DIR")"
AGENTOPS_VAULT="${AGENTOPS_VAULT:-$HOME/repos/AgentOps}"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
info() { echo -e "  ${BLUE}ℹ${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }

# ── Required plugins (from PLAN-obsidian-gittui.md §6) ──────────────────────

CORE_PLUGINS=(
	file-explorer global-search switcher graph backlink canvas
	outgoing-link tag-pane page-preview daily-notes templates
	command-palette file-recovery properties bookmarks
)

COMMUNITY_PLUGINS=(
	dataview obsidian-tasks-plugin templater-obsidian periodic-notes
	calendar obsidian-git cmdr buttons obsidian-meta-bind-plugin
	obsidian-advanced-uri quickadd obsidian-kanban
	obsidian-excalidraw-plugin omnisearch obsidian-linter
	obsidian-style-settings
)

# ── Helpers ──────────────────────────────────────────────────────────────────

has_json_tool() {
	command -v python3 &>/dev/null || command -v jq &>/dev/null
}

write_json() {
	local file="$1"
	local content="$2"
	mkdir -p "$(dirname "$file")"
	echo "$content" > "$file"
}

ensure_dir() {
	mkdir -p "$1"
}

# ── Phases ───────────────────────────────────────────────────────────────────

phase_vault_skeleton() {
	echo ""
	echo "── Phase 1: Vault skeleton ──"

	ensure_dir "$AGENTOPS_VAULT"/Inbox
	ensure_dir "$AGENTOPS_VAULT"/Projects
	ensure_dir "$AGENTOPS_VAULT"/Runs
	ensure_dir "$AGENTOPS_VAULT"/Reviews
	ensure_dir "$AGENTOPS_VAULT"/System/Templates
	ensure_dir "$AGENTOPS_VAULT"/System/Dashboards

	# .gitkeep files
	for dir in Inbox Projects Runs Reviews; do
		gitkeep="$AGENTOPS_VAULT/$dir/.gitkeep"
		[[ ! -f "$gitkeep" ]] && touch "$gitkeep" && ok "$dir/.gitkeep"
	done

	ok "Vault skeleton at $AGENTOPS_VAULT"
}

phase_gitignore() {
	local target="$AGENTOPS_VAULT/.gitignore"
	if [[ -f "$target" ]]; then
		ok ".gitignore exists"
		return
	fi

	cat > "$target" <<-'GITIGNORE'
		# AgentOps vault gitignore — partial tracking policy
		# See dotfiles/docs/PLAN-obsidian-gittui.md §4 for rationale

		# Workspace/cache — not portable
		.obsidian/workspace*.json
		.obsidian/cache/
		.obsidian/plugins/*/main.js
		.obsidian/plugins/*/styles.css
		.obsidian/plugins/*/assets/

		# Temp / trash
		.trash/

		# Raw artifacts (keep the notes, not the binaries)
		Reviews/_artifacts/raw/

		# OS junk
		*.tmp
		.DS_Store
		Thumbs.db
	GITIGNORE
	ok ".gitignore written"
}

phase_obsidian_config() {
	echo ""
	echo "── Phase 2: .obsidian config ──"

	local obs_dir="$AGENTOPS_VAULT/.obsidian"
	ensure_dir "$obs_dir"

	# core-plugins.json
	local core="$obs_dir/core-plugins.json"
	if [[ ! -f "$core" ]]; then
		local uuid
		uuid=$(uuidgen 2>/dev/null || echo "agentops-$(date +%s)")
		write_json "$core" \
"{
  \"id\": \"$uuid\",
  \"plugins\": $(printf '%s\n' "${CORE_PLUGINS[@]}" | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))' 2>/dev/null || printf '%s\n' "${CORE_PLUGINS[@]}" | jq -R . | jq -s .)
}"
		ok "core-plugins.json ($(printf '%s' "${CORE_PLUGINS[*]}" | wc -w | tr -d ' ') plugins)"
	else
		ok "core-plugins.json exists"
	fi

	# community-plugins.json
	local comm="$obs_dir/community-plugins.json"
	if [[ ! -f "$comm" ]]; then
		printf '%s\n' "${COMMUNITY_PLUGINS[@]}" | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))' 2>/dev/null > "$comm" || \
		printf '%s\n' "${COMMUNITY_PLUGINS[@]}" | jq -R . | jq -s . > "$comm"
		ok "community-plugins.json ($(printf '%s' "${COMMUNITY_PLUGINS[*]}" | wc -w | tr -d ' ') plugins)"
	else
		ok "community-plugins.json exists"
	fi

	# app.json
	local app="$obs_dir/app.json"
	if [[ ! -f "$app" ]]; then
		write_json "$app" \
'{
  "vimMode": true,
  "alwaysUpdateLinks": true,
  "newFileLocation": "folder",
  "newFileFolderPath": "Inbox",
  "attachmentFolderPath": "Inbox/_attachments",
  "promptDelete": false,
  "tabSize": 4,
  "showLineNumber": true,
  "showIndentGuide": true,
  "spellcheck": true
}'
		ok "app.json"
	else
		ok "app.json exists"
	fi

	# appearance.json
	local appearance="$obs_dir/appearance.json"
	if [[ ! -f "$appearance" ]]; then
		write_json "$appearance" \
'{
  "accentColor": "#7c3aed",
  "cssTheme": "",
  "enabledCssSnippets": [],
  "baseTheme": "system",
  "interfaceFontFamily": "",
  "textFontFamily": "",
  "monospaceFontFamily": ""
}'
		ok "appearance.json"
	else
		ok "appearance.json exists"
	fi
}

phase_templates() {
	echo ""
	echo "── Phase 3: Templates & dashboards ──"

	local tmpl="$AGENTOPS_VAULT/System/Templates"
	local dash="$AGENTOPS_VAULT/System/Dashboards"

	ensure_dir "$tmpl"
	ensure_dir "$dash"

	# Run template
	if [[ ! -f "$tmpl/Run.md" ]]; then
		cat > "$tmpl/Run.md" <<-'RUN'
			---
			type: run
			project: "{{project}}"
			harness: "{{harness}}"
			agent: "{{agent}}"
			model: "{{model}}"
			status: created
			session_id: "{{session_id}}"
			session_file: "{{session_file}}"
			repo: "{{repo}}"
			branch: "{{branch}}"
			commit: "{{commit}}"
			created: "{{created}}"
			updated: "{{created}}"
			tags: [agentops, run, {{harness}}]
			---

			# {{title}}

			## TLDR

			<!-- Quick summary of what this run accomplished -->

			## Current State

			<!-- What was done, what's pending, blockers -->

			## Decisions

			## Files / Artifacts

			## Compressed History

			## Links
		RUN
		ok "Templates/Run.md"
	fi

	# Spec template
	if [[ ! -f "$tmpl/Spec.md" ]]; then
		cat > "$tmpl/Spec.md" <<-'SPEC'
			---
			type: spec
			project: "{{project}}"
			status: draft
			created: "{{created}}"
			updated: "{{created}}"
			tags: [agentops, spec]
			---

			# {{title}}

			## Goal

			## Requirements

			## Design Decisions

			## Questions

			## Next Steps
		SPEC
		ok "Templates/Spec.md"
	fi

	# Review template
	if [[ ! -f "$tmpl/Review.md" ]]; then
		cat > "$tmpl/Review.md" <<-'REVIEW'
			---
			type: review
			project: "{{project}}"
			batch_id: "{{batch_id}}"
			status: pending
			base_commit: "{{base_commit}}"
			sandbox_path: "{{sandbox_path}}"
			review_ledger: "{{review_ledger}}"
			diffview_artifact: ""
			created: "{{created}}"
			updated: "{{created}}"
			tags: [agentops, review]
			---

			# Review: {{title}}

			## Batch

			## Files

			## Stale / Conflict Warnings

			## Links
		REVIEW
		ok "Templates/Review.md"
	fi

	# Dashboards
	if [[ ! -f "$dash/AgentOps.md" ]]; then
		cat > "$dash/AgentOps.md" <<-'DASH'
			# AgentOps Dashboard

			```dataview
			TABLE file.ctime as Created, file.mtime as Updated, type as Type, status as Status
			FROM "Runs" OR "Projects" OR "Reviews"
			SORT file.mtime DESC
			LIMIT 20
			```
		DASH
		ok "Dashboards/AgentOps.md"
	fi

	if [[ ! -f "$dash/Runs.md" ]]; then
		cat > "$dash/Runs.md" <<-'DASH'
			# Active Runs

			```dataview
			TABLE project as Project, harness as Harness, agent as Agent, status as Status, commit as Commit
			FROM "Runs"
			WHERE status = "active"
			SORT file.mtime DESC
			```
		DASH
		ok "Dashboards/Runs.md"
	fi

	if [[ ! -f "$dash/Reviews.md" ]]; then
		cat > "$dash/Reviews.md" <<-'DASH'
			# Pending Reviews

			```dataview
			TABLE project as Project, batch_id as Batch, base_commit as Base, status as Status
			FROM "Reviews"
			WHERE status != "applied" AND status != "rejected"
			SORT file.mtime DESC
			```
		DASH
		ok "Dashboards/Reviews.md"
	fi

	# Plugin guard doc
	if [[ ! -f "$AGENTOPS_VAULT/System/plugin-guard.md" ]]; then
		cat > "$AGENTOPS_VAULT/System/plugin-guard.md" <<-'GUARD'
			# Plugin Guard

			Required plugin sets for AgentOps vault.

			## Required core plugins

			file-explorer, global-search, switcher, graph, backlink, canvas,
			outgoing-link, tag-pane, page-preview, daily-notes, templates,
			command-palette, file-recovery, properties, bookmarks

			## Required community plugins

			dataview, obsidian-tasks-plugin, templater-obsidian, periodic-notes,
			calendar, obsidian-git, cmdr, buttons, obsidian-meta-bind-plugin,
			obsidian-advanced-uri, quickadd, obsidian-kanban,
			obsidian-excalidraw-plugin, omnisearch, obsidian-linter,
			obsidian-style-settings

			## Last guard run

			<!-- pi:agentops-guard:start -->
			_never run_
			<!-- pi:agentops-guard:end -->
		GUARD
		ok "System/plugin-guard.md"
	fi

	ok "Templates and dashboards ready"
}

phase_git_init() {
	echo ""
	echo "── Phase 4: Git tracking ──"

	if [[ -d "$AGENTOPS_VAULT/.git" ]]; then
		ok "Git already initialized"
		return
	fi

	cd "$AGENTOPS_VAULT" && git init && git add \
		.gitignore \
		.obsidian/app.json \
		.obsidian/appearance.json \
		.obsidian/core-plugins.json \
		.obsidian/community-plugins.json \
		System/plugin-guard.md \
		System/Templates/Run.md \
		System/Templates/Spec.md \
		System/Templates/Review.md \
		System/Dashboards/AgentOps.md \
		System/Dashboards/Runs.md \
		System/Dashboards/Reviews.md \
		Inbox/.gitkeep \
		Projects/.gitkeep \
		Runs/.gitkeep \
		Reviews/.gitkeep && \
	git commit -m "chore: bootstrap AgentOps vault skeleton" || true

	ok "Git initialized with initial commit"
}

phase_plugin_guard() {
	echo ""
	echo "── Phase 5: Plugin guard ──"

	local report="$AGENTOPS_VAULT/System/plugin-guard-last-run.md"
	local modified=false

	# Check core plugins
	local core_json="$AGENTOPS_VAULT/.obsidian/core-plugins.json"
	local missing_core=()
	if [[ -f "$core_json" ]]; then
		for plugin in "${CORE_PLUGINS[@]}"; do
			if ! grep -q "\"$plugin\"" "$core_json" 2>/dev/null; then
				missing_core+=("$plugin")
			fi
		done
		if [[ ${#missing_core[@]} -gt 0 ]]; then
			warn "Missing core plugins: ${missing_core[*]} — repairing"
			python3 -c "
import json
with open('$core_json') as f:
    cfg = json.load(f)
existing = cfg.get('plugins', [])
for p in ${missing_core[*]/#/}:
    if p not in existing:
        existing.append(p)
cfg['plugins'] = existing
with open('$core_json', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null || true
			modified=true
		fi
	fi

	# Check community plugins
	local comm_json="$AGENTOPS_VAULT/.obsidian/community-plugins.json"
	local missing_comm=()
	if [[ -f "$comm_json" ]]; then
		for plugin in "${COMMUNITY_PLUGINS[@]}"; do
			if ! grep -q "\"$plugin\"" "$comm_json" 2>/dev/null; then
				missing_comm+=("$plugin")
			fi
		done
		if [[ ${#missing_comm[@]} -gt 0 ]]; then
			warn "Missing community plugins: ${missing_comm[*]} — repairing"
			python3 -c "
import json
with open('$comm_json') as f:
    plugins = json.load(f)
existing = plugins if isinstance(plugins, list) else []
for p in ${missing_comm[*]/#/}:
    if p not in existing:
        existing.append(p)
with open('$comm_json', 'w') as f:
    json.dump(existing, f, indent=2)
" 2>/dev/null || true
			modified=true
		fi
	fi

	# Check plugin folders
	local missing_folders=()
	for plugin in "${COMMUNITY_PLUGINS[@]}"; do
		[[ ! -d "$AGENTOPS_VAULT/.obsidian/plugins/$plugin" ]] && missing_folders+=("$plugin") || true
	done

	# Write guard report
	{
		echo "# Plugin Guard — Last Run"
		echo ""
		echo "Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
		echo ""
		if $modified; then
			echo "Status: **repairs made**"
		elif [[ ${#missing_folders[@]} -gt 0 ]]; then
			echo "Status: **plugins missing** (need install)"
		else
			echo "Status: **clean**"
		fi
		echo ""
		echo "## Core plugins"
		for p in "${CORE_PLUGINS[@]}"; do
			echo "- [x] $p"
		done
		echo ""
		echo "## Community plugins"
		for p in "${COMMUNITY_PLUGINS[@]}"; do
			if [[ -d "$AGENTOPS_VAULT/.obsidian/plugins/$p" ]]; then
				echo "- [x] $p"
			else
				echo "- [ ] $p (folder missing — install in Obsidian)"
			fi
		done
	} > "$report"

	if $modified; then
		ok "Plugin config repaired"
	fi
	if [[ ${#missing_folders[@]} -gt 0 ]]; then
		warn "${#missing_folders[@]} community plugin(s) need install — run 'ao open' then install in Obsidian"
	elif [[ ${#missing_core[@]} -eq 0 ]]; then
		ok "All plugins OK"
	fi
	ok "Guard report: $report"
}

phase_symlink_ao() {
	echo ""
	echo "── Phase 6: Symlink ao helper ──"

	local target="$HOME/.local/bin/ao"
	mkdir -p "$HOME/.local/bin"

	if [[ -L "$target" ]] || [[ ! -f "$target" ]]; then
		ln -sf "$SCRIPT_DIR/ao" "$target"
		ok "~/.local/bin/ao → $SCRIPT_DIR/ao"
	else
		warn "$target exists and is not a symlink — skipping"
	fi
}

phase_status_report() {
	echo ""
	echo "── Status report ──"

	local has_git=false
	local has_config=true
	local has_notes=0
	local has_guard=false

	[[ -d "$AGENTOPS_VAULT/.git" ]] && has_git=true
	[[ -f "$AGENTOPS_VAULT/.obsidian/core-plugins.json" ]] || has_config=false
	has_notes=$(find "$AGENTOPS_VAULT" -name "*.md" -not -path "*/.obsidian/*" 2>/dev/null | wc -l | tr -d ' ')
	[[ -f "$AGENTOPS_VAULT/System/plugin-guard-last-run.md" ]] && has_guard=true

	echo "  Vault:   $AGENTOPS_VAULT"
	echo "  Git:     $($has_git && echo 'yes' || echo 'no')"
	echo "  Config:  $($has_config && echo 'yes' || echo 'no')"
	echo "  Notes:   $has_notes"
	echo "  Guard:   $($has_guard && grep "^Date:" "$AGENTOPS_VAULT/System/plugin-guard-last-run.md" 2>/dev/null || echo 'never run')"
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     AgentOps Vault Setup                         ║"
echo "║     $AGENTOPS_VAULT"
echo "╚══════════════════════════════════════════════════╝"

case "${1:-}" in
	--repair|-r)
		phase_plugin_guard
		phase_status_report
		;;
	--status|-s)
		phase_status_report
		;;
	--help|-h)
		echo "Usage: $0 [--repair|--status|--help]"
		echo "  (no args)  Full idempotent bootstrap"
		echo "  --repair   Plugin guard only"
		echo "  --status   Report only, no changes"
		exit 0
		;;
	*)
		phase_vault_skeleton
		phase_gitignore
		phase_obsidian_config
		phase_templates
		phase_git_init
		phase_plugin_guard
		phase_symlink_ao
		phase_status_report
		echo ""
		echo "Done. Next steps:"
		echo "  1. ao open          # open vault in Obsidian"
		echo "  2. Install community plugins in Obsidian"
		echo "  3. ao repair        # verify plugins installed"
		echo "  4. ao note 'hello'  # quick capture smoke test"
		;;
esac
