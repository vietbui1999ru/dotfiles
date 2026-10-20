# Pi Transcript View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the `/pi` pane, the selected task's transcript shows what Pi is doing step by step: full tool calls, the first lines of tool output, and, behind a `t` toggle, Pi's thinking summaries.

**Architecture:** `session-band-plugin/hooks/pisession.ts` `fold()` already tails Pi's session JSONL every 2 s (`handoff.tsx` poll) and turns assistant text and tool calls into `TranscriptEntry`s. This plan adds two entry kinds, `thinking` and `output`, stops truncating tool-call text in the transcript, and renders the new kinds in `pane.tsx`, with a `showThinking` toggle in the handoff atom. No dispatch change: granularity stays one step per finished message, as Pi writes them.

**Tech Stack:** TypeScript Claude Code plugin (`claude-code` engine, `claude-code/testing` kit).

**Spec:** this plan. The person approved it in chat on 2026-10-19: Enter on a Monitor row focuses that task (already the case, since the row Button selects it), tool output is shown dimmed, and `t` toggles thinking. Word-by-word streaming (`pi --mode json`) is out of scope.

## Global Constraints

- Work on branch `feat/pi-transcript-view` (cut from `origin/main` at 40630df). Commit per task, staging by path. Do not push, open a PR, merge or rebase.
- `lastActivity` (the Monitor row's activity column) keeps today's short form: `bash <first 40 chars>` or `<tool> <path>`. Only transcript entries get the longer text.
- Pi's thinking blocks are `{ type: 'thinking', thinking: string, thinkingSignature: string }`. With OpenAI models, `thinking` is often `''` (encrypted reasoning) and sometimes a short summary. Never render `thinkingSignature`.
- The transcript keeps its cap of 200 entries (`append` in `pisession.ts`).
- `t` is a Button `hotkey` in the key bar, labelled `thinking`, because unbound keys fall through to the composer. `t` is unused in `pane.tsx` today.
- Plugin tests: `cd session-band-plugin && claude plugin test .`. All must pass, with the full-suite count reported.

## Review Focus

1. A long run of empty thinking blocks between tool calls. Expect one `· thinking…` marker per block when the toggle is on, and no lines when it is off. Test in Task 1 (consecutive empty blocks collapse to one marker).
2. Tool output that is huge (a file dump) or has `\r\n` line endings. Expect at most 2 lines of at most 160 characters each, with no carriage returns. Test in Task 1.
3. A toolResult with `isError: true`. Expect today's `error` entry, not an `output` entry as well. Test in Task 1.
4. Toggling `t` while no task is selected. Expect no crash; the setting persists for the next selected task. Test in Task 2.
5. A bash command with newlines (heredocs). Expect the transcript line to collapse whitespace to single spaces, as `lastActivity` does, and cap it at 200 characters. Test in Task 1.

---

### Task 1: `thinking` and `output` entries in `fold`

**Files:**
- Modify: `session-band-plugin/hooks/pisession.ts`
- Create: `session-band-plugin/hooks/pisession.test.ts`

**Interfaces:**
- Produces: `TranscriptEntry = { kind: 'text' | 'tool' | 'error' | 'thinking' | 'output'; text: string }`.
  - `thinking.text` is the trimmed summary, or `''` for an empty or encrypted block.
  - `output.text` is the tool result's text blocks joined, cut to its first 2 non-empty lines, each line trimmed of `\r` and capped at 160 characters with `…`, joined by `\n`.
  - `tool.text` for bash is `bash <command, whitespace collapsed, capped at 200 chars>`; other tools stay `<name> <path>`.
  - `fold`'s signature is unchanged.

- [ ] **Step 1: Write the failing tests** in `pisession.test.ts`, folding hand-written JSONL lines into `emptyProgress()`:
  - An assistant message with a `thinking` block `'**Plan**\n\nRead the spec'` gives an entry `{ kind: 'thinking', text: '**Plan**\n\nRead the spec' }`.
  - Two consecutive assistant messages each holding only an empty thinking block give one `{ kind: 'thinking', text: '' }` entry, not two (Review Focus 1).
  - A toolResult with text `'line1\r\nline2\r\nline3'` gives `{ kind: 'output', text: 'line1\nline2' }`. A 500-character single line gives 160 characters ending in `…` (Review Focus 2).
  - A toolResult with `isError: true` gives one `error` entry and no `output` entry (Review Focus 3).
  - A bash toolCall with command `"cat <<'EOF'\nabc\nEOF"` gives a `tool` entry `bash cat <<'EOF' abc EOF`, while `lastActivity` is still the 40-character form. A 300-character command gives a 200-character entry (Review Focus 5).
- [ ] **Step 2: Run them.** `claude plugin test .` → FAIL.
- [ ] **Step 3: Implement in `pisession.ts`.** Extend the assistant-content loop for `item.type === 'thinking'`; when the new entry would be empty and the previous entry is an empty thinking entry, skip it. Extend the `toolResult` branch for non-error results. Build the bash transcript text separately from `lastActivity`.
- [ ] **Step 4: Run the whole suite.** `claude plugin test .` → PASS. `handoff.test.ts` and `pisession-error.test.ts` must still pass unchanged; if one fails, report it rather than editing it.
- [ ] **Step 5: Commit.** `feat(session-band): Pi transcript keeps thinking summaries and tool output`

### Task 2: render the new entries and the `t` toggle

**Files:**
- Modify: `session-band-plugin/hooks/handoff.tsx` (`HandoffState` :7 gains `showThinking?: boolean`)
- Modify: `session-band-plugin/hooks/pane.tsx` (the key bar, and the transcript render near `transcript.map` ~:417)
- Modify or create: `session-band-plugin/hooks/pane.test.ts`, or a kit test beside `pane-keys.test.ts`

**Interfaces:**
- Consumes: `TranscriptEntry` from Task 1.
- Produces: the exported pure function `transcriptLines(entries: readonly TranscriptEntry[], showThinking: boolean): { key: string; text: string; dim: boolean }[]` in `pane.tsx`.

Rendering rules for `transcriptLines`:
- `text` → `entry.text.slice(0, 280)`, not dim.
- `tool` → `entry.text`, not dim.
- `output` → each line prefixed `  ↳ `, dim.
- `error` → `ERROR ${text}`, not dim (drawn as today).
- `thinking` with `showThinking` → `  · ${text}` for a summary, or `  · thinking…` when empty, dim. With the toggle off, thinking entries are dropped.

In the render, each line becomes `<Text key dimColor={dim}>`. The key bar gains `<Button key="pi-key-thinking" plain dimColor hotkey="t" label={state.showThinking ? 'hide thinking' : 'thinking'} …/>`, which flips `showThinking` in the handoff atom.

- [ ] **Step 1: Write the failing tests.**
  - `transcriptLines` with the toggle off drops thinking entries.
  - With the toggle on, it draws `  · thinking…` for an empty entry and `  · **Plan**` for a summary.
  - An `output` entry `'a\nb'` gives two dim lines, `  ↳ a` and `  ↳ b`.
  - Kit test: pressing `pi-key-thinking` with no tracked tasks does not throw, and sets `showThinking` to true in the handoff atom (Review Focus 4).
- [ ] **Step 2: Run them** → FAIL. **Step 3: implement.** **Step 4: run the whole suite** → PASS.
- [ ] **Step 5: Commit.** `feat(session-band): /pi transcript shows tool output and a t thinking toggle`

### Task 3: final checks

- [ ] **Step 1: Run** `cd session-band-plugin && claude plugin test .` and `~/dotfiles/scripts/floor-guard`. Report both outputs.
- [ ] **Step 2: Stop.** Report the commit hashes and any choice the plan left open. Do not push.
