---
status: approved
branch: feat/ctx-cap
---
# SPEC: Cap effective session context at 500K tokens

## Objective
Keep Claude Code and Pi sessions under 500K tokens instead of the 1M model window, with a save-and-clear prompt at 350K (70% of 500K). Success: Claude auto-compacts at 500K, and only after save-session has had a chance to run. The session-band guard fires at 350K tokens, not at 700K (today it compares a percent of the 1M window with 70). Pi dispatches compact at 500K.

## Acceptance Criteria
- AC-1: Claude settings enable auto-compaction
  verify: `jq -e '.autoCompactEnabled == true' claude/.claude/settings.json`
- AC-2: Claude settings set the auto-compact window to 500000 tokens
  verify: `jq -e '.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW == "500000"' claude/.claude/settings.json`
- AC-3: The session-band guard and soft-stop trigger on 350000 context tokens (349999 passes, 350000 triggers), not on percent of the model window
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "\(pass\) .*350000"`
- AC-4: The session-band context chip shows percent of the 500K cap (250000 tokens renders 50%)
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "\(pass\) .*500K cap"`
- AC-5: All session-band plugin tests pass
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "^ *0 fail$"`
  baseline: pass
- AC-6: The statusline computes context percent against 500K from token counts (fixture at 250000 input tokens prints 50%)
  verify: `bash claude/.claude/hooks/tests/statusline-cap.test.sh`
- AC-7: A PreCompact hook blocks the first auto compaction of a session when session-state.md is older than 5 minutes, and lets the second through
  verify: `bash claude/.claude/hooks/tests/precompact-save.test.sh`
- AC-8: The PreCompact hook is registered in Claude settings
  verify: `jq -e '[.hooks.PreCompact[]?.hooks[]?.command] | any(test("precompact-save.sh"))' claude/.claude/settings.json`
- AC-9: Pi compaction is enabled, with reserveTokens set so each scoped opencode-go model with a window over 500K compacts at about 500K (claude-haiku-5-5, deepseek-v4.1-flash, deepseek-v4-pro, glm-5.3, kimi-k3, qwen3.8-max, minimax-m3)
  verify: `jq -e '. as $r | .compaction.enabled == true and (["claude-haiku-5-5","deepseek-v4.1-flash","deepseek-v4-pro","glm-5.3","kimi-k3","qwen3.8-max","minimax-m3"] | all(($r.compaction.modelOverrides["opencode-go/" + .].reserveTokens // 0) as $t | $t >= 480000 and $t <= 600000))' "$HOME/.pi/agent/settings.json"`
- AC-10: zsh records timestamps in history
  verify: `rg -q "EXTENDED_HISTORY" zsh/.zshrc`
- AC-11: Existing hook tests still pass
  verify: `bash claude/.claude/hooks/tests/design-on-write.test.sh match && bash claude/.claude/hooks/tests/design-on-write.test.sh non_ui && bash claude/.claude/hooks/tests/design-on-write.test.sh once_per_session && bash claude/.claude/hooks/tests/design-on-write.test.sh no_false_positives && bash claude/.claude/hooks/tests/jj-colocate-worktree.test.sh`
  baseline: pass
- AC-12: In a live Claude session the band warns near 350K tokens and auto-compaction happens near 500K
  verify: manual - needs a real long session

## Boundaries
### Always
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
- Keep the existing guard behavior (block Agent spawns, soft-stop directive, save-file exemptions, 5-minute debounce); change only what it measures
### Ask first
- Any new Pi extension (Pi stays lean)
- Changing the 350K/500K numbers
### Never
- Edit a `verify:` line or a test to make a check pass
- Let the PreCompact hook block more than once per session (a session must never be held up to the 1M window)

## Open Questions
- Pi's `~/.pi/agent/settings.json` is not stowed from dotfiles, so it is edited in place. Default: edit in place and leave stowing to the multi-machine portability work.
- reserveTokens also caps Pi's summarization output at the model's max output. Default: accept that; the summary is still bounded by max output tokens.
- Per-session state for "already blocked once": default to a marker file `~/.claude/state/precompact-blocked/<session_id>`.
