---
status: active
updated: 2026-07-22T02:25:18Z
repo: /Users/vietquocbui/dotfiles
mode: implement
---

# Session State — Pi Provider Harness + ACP Bridge Specification

## Goal saved

Revise the Pi Provider Harness plan to include an ACP (Agent Client Protocol) bridge so Pi can talk to a Claude Code instance, override Claude Code's internal system prompt with Pi's system prompt, and evaluate the positive/negative outcomes for token costs and efficiency.

## Completed

- Wrote normative provider SPEC (`20260716_pi-provider-harness-and-antigravity-routes-spec.md`, v2) and PLAN (`...-routes-plan.md`, v2) in `~/repos/AgentOps/Projects/`.
- Updated parent canonical spec (`20260715_agentops-canonical-communication-plane-spec.md`, v5) to defer provider routing to the dedicated documents and remove contradictory Antigravity-support language.
- Updated local pointer doc (`docs/SPEC-agentops-canonical-communication-plane.md`).
- Ran four rounds of review council (architecture, security, Pi implementation):
  - R1: 12 blockers → rewrote entire SPEC/PLAN around Pi 0.80.6 reality.
  - R2: architecture/security PASS, implementation had one tool-budget failure but re-review PASS.
  - R3: all three PASS after retry-control, authorization, and plan gate corrections.
  - R4: three FAIL on architecture (rollback, phase ordering, outcome-unknown), security (opaque relay), implementation (retry events RPC-only).
  - Updated review note `Sessions/Reviews/2026-07-16_pi-provider-harness-antigravity-routes.md` with verdict REVISE and five blocking revisions.
- Verified all nine normative invariants (no session dumps, Antigravity blocked, no custom Claude OAuth, outcome-unknown, retry blocked, etc.).
- Validated `git diff --check` and internal cross-reference paths.
- Observed existing dirty working tree with unrelated changes and subagent artifacts.
- Started ACP (Agent Client Protocol) investigation:
  - Researched @agentclientprotocol/claude-agent-acp v0.59.0 source code (adapter repo under Zed Industries/agentclientprotocol).
  - Found that ACP sessions accept `_meta.systemPrompt` which can override Claude's system prompt (the adapter defaults to `{type: "preset", preset: "claude_code"}` but accepts a string or object via `_meta`).
  - Found `_meta.claudeCode.options` can pass `tools`, `disallowedTools`, `settingSources`, etc.
  - The adapter uses `@anthropic-ai/claude-agent-sdk` v0.3.207, which is a separate Agent SDK (not just a model API).
  - Claude Code CLI has `--system-prompt`, `--append-system-prompt`, `--tools`, `--print`, `-p` flags.
  - Token cost/overhead documented for agent teams, prompt caching, auto-compaction.
- Launched parallel research subagent (researcher + context-builder + reviewer) for ACP architecture evidence but it exceeded turn budget.
- Collected primary source docs in `.firecrawl/acp-claude/` (ACP spec, adapter source, SDK docs, costs).

## In Progress / incomplete

1. Synthesis of ACP architecture into the provider SPEC/PLAN.
   - Next exact step: determine whether ACP is a bounded delegate (Pi owns tools) or a primary backend (Claude Code owns tools), then write the ACP bridge plan section.
2. Token cost and efficiency analysis for ACP mode vs. native Pi provider.
3. Subagent artifacts to review/clean up before any commit.

## Decisions / caveats

- ACP adapter (`claude-agent-acp`) runs Claude Code as a subprocess over JSON-RPC 2.0 over stdio.
- The adapter internally uses the Claude Agent SDK, which is a full agent framework with its own tools, sessions, and hook system — not just a model API.
- System prompt override is possible via `_meta.systemPrompt` in `session/new`.
- Tool override is possible via `_meta.claudeCode.options.tools` and `disallowedTools`.
- Prompt caching and auto-compaction are built into Claude Code; Pi would not need to reimplement them.
- Harness boundary decision is the highest-stakes question: Pi must remain the sole harness under the canonical spec.

## Working tree snapshot

Uncommitted changes include `.claude/session-state.md`, `.pi/diff-review/decisions.jsonl`, `.pi/diff-review/latest.md`, `.pi/session-state.md`, `scripts/setup-agentops.sh`, `tmux/.tmux.conf`, `zsh/.zshrc`, and `.pi-subagents/artifacts/*`. AgentOps repo has an updated parent spec and two new untracked provider documents.

## Next session will

1. Synthesize the ACP bridge design into a plan revision.
2. Determine Pi-sole-harness compatibility for ACP integration.
3. Complete the token cost/efficiency analysis.
4. Update the canonical SPEC/PLAN with the ACP bridge section.
5. Run review council on the revised documents.

## Files to inspect first next session

- `.firecrawl/acp-claude/acp-agent-ts.txt` (ACP adapter source, lines 5018–5241 for systemPrompt/options)
- `.firecrawl/acp-claude/claude-acp.md` (README of @agentclientprotocol/claude-agent-acp)
- `.firecrawl/acp-claude/index-ts.txt` (entry point, stdin/stdout ACP transport)
- `.firecrawl/acp-claude/claude-costs.md` (token cost and efficiency guidance)
- `.firecrawl/acp-claude/sdk-overview.md` (Claude Agent SDK architecture)
- `~/repos/AgentOps/Projects/20260716_pi-provider-harness-and-antigravity-routes-spec.md`
- `~/repos/AgentOps/Projects/20260716_pi-provider-harness-and-antigravity-routes-plan.md`
- `~/repos/AgentOps/Sessions/Reviews/2026-07-16_pi-provider-harness-antigravity-routes.md`
