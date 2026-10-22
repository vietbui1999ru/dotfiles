# Context injection breaks Claude extended thinking from turn 2 (400 "thinking block is bound to a different conversation")

**Status:** draft for review, not filed (2026-10-21). Our workaround: Claude runs in Pi with thinking off (PR #149).

**File at:** https://github.com/apmantza/pi-lens/issues/new

## Summary

With context injection on (the default), every Pi session on a Claude model with extended thinking fails from the second turn with a 400 from the Anthropic API. pi-lens's `context` handler appends its one-shot automated context to the last user message for a single request, but the change is never saved to the session. Claude's thinking blocks are signed against the exact request prefix they were produced from, so on the next turn the replayed thinking block no longer matches the (now unaugmented) earlier message, and the API rejects it.

## Environment

- pi-lens 4.4.3
- pi 1.3.0, Node 26.12.0, macOS 27.0.1
- Model: `opencode-go/claude-haiku-5-5` with thinking `medium` (any Claude model with thinking on should behave the same)

## Reproduce

In any directory, two print-mode turns on one session, with only pi-lens loaded:

```sh
pi --model opencode-go/claude-haiku-5-5:medium --no-extensions --no-skills \
  -e <path-to>/pi-lens --session-id lens-repro -p "Reply with exactly: one" < /dev/null
pi --model opencode-go/claude-haiku-5-5:medium --no-extensions --no-skills \
  -e <path-to>/pi-lens --session-id lens-repro -p "Reply with exactly: two" < /dev/null
```

Turn 1 prints `one` followed by `[pi-lens automated context — not a user request]`. Turn 2 fails:

```
400 {"type":"error","error":{"type":"invalid_request_error","message":"Upstream request failed: [invalid_request_error] messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to \"drop_block\". ... Content that preceded this block when it was created is missing from this request, starting at `messages.0.content.0`."}}
```

The same happens in an interactive session on the second prompt.

## Isolation

| Setup | Result |
|---|---|
| `pi --no-extensions --no-skills` | both turns work |
| pi-lens only (above) | turn 2 fails |
| pi-lens only, `PI_LENS_NO_CONTEXT_INJECTION=1` | 3 turns work |
| pi-lens only, `--no-lens-context` | turn 2 still fails (see note below) |
| any setup, thinking `off` | works |

## Cause

`dist/index.js` (4.4.3), the `context` handler registered around line 145004:

1. `consumeSessionStartGuidance`, `consumeTurnEndFindings`, `consumeStagedTestRunnerFindings` and `consumeAgentNudge` each return their message once and then clear their cache.
2. When the last message is a plain user prompt, the handler returns `{ messages }` with that message's content extended (`append-to-last-user`, around lines 145085-145099).
3. The returned list replaces the messages for that one provider request only; nothing is written to the session.

Turn 1's request is therefore `[user: "<prompt>\n\n[pi-lens automated context …]"]`, and the assistant's signed thinking is bound to that content. Turn 2's request replays the session as `[user: "<prompt>", assistant: <thinking …>, user: "<prompt 2>"]`, so `messages.0.content.0` differs from what the signature was made over.

## Suggested fix

Any one of these keeps the replayed prefix byte-identical:

- Persist the injected context as its own session entry (for example a custom message entry), so later turns replay exactly what was sent.
- Or, when the active model is an Anthropic model with thinking enabled, deliver the context in a way that does not change earlier request content: as a new trailing message that is then saved, or not at all.
- Or let the injection be turned off per model or provider, so Claude sessions can opt out while other models keep it.

## Note: `--no-lens-context` had no effect

Loading pi-lens with `-e <path>` and passing `--no-lens-context`, the marker text still appeared and turn 2 still failed. `PI_LENS_NO_CONTEXT_INJECTION=1` did disable it. I did not check whether the flag works when pi-lens is installed as a package rather than loaded with `-e`.
