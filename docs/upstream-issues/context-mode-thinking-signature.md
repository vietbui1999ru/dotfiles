# Pi adapter: per-request context message breaks Claude extended thinking from turn 3 (400 "thinking block is bound to a different conversation")

**Status:** draft for review, not filed (2026-10-21). Our workaround: Claude runs in Pi with thinking off (PR #149).

**File at:** https://github.com/mksglu/context-mode/issues/new

## Summary

In the Pi adapter, the `context` hook pushes an extra user message (routing anchor plus `<active_memory>`) onto the end of each provider request, but that message is never saved to the session. With a Claude model and extended thinking on, the assistant's signed thinking is bound to the request it was produced from. On a following turn the replayed history no longer contains the injected message, so the Anthropic API rejects the earlier thinking block with a 400. In my runs the first replay (turn 2) passed and turn 3 failed; I did not determine why turn 1's thinking block was accepted (possibly no signed thinking for a trivial first prompt).

## Environment

- context-mode 1.0.169 (Pi adapter, `build/adapters/pi/extension.js`)
- pi 1.3.0, Node 26.12.0, macOS 27.0.1
- Model: `opencode-go/claude-haiku-5-5` with thinking `medium`

## Reproduce

Three print-mode turns on one session, with only context-mode loaded:

```sh
for t in one two three; do
  pi --model opencode-go/claude-haiku-5-5:medium --no-extensions --no-skills \
    -e <path-to>/context-mode --session-id cm-repro -p "Reply with exactly: $t" < /dev/null
done
```

Turns 1 and 2 print `one` and `two`. Turn 3 fails:

```
400 ... messages.3.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. ... Content that preceded this block when it was created is missing from this request, starting at `messages.2.content.0`.
```

In a run that also loaded other extensions, the same error said: "The `tools` list and the earlier `messages` both differ from when this block was created."

## Isolation

| Setup | Result |
|---|---|
| `pi --no-extensions --no-skills` | works |
| context-mode only (above) | turn 3 fails |
| context-mode with thinking `off` (`claude-haiku-5-5:off`) | works |

## Cause

`build/adapters/pi/extension.js` (1.0.169):

- `before_agent_start` (around lines 531-653) builds `_pendingContext` from the routing anchor, `<active_memory>` and any unconsumed resume snapshot.
- `context` (around lines 658-673) does `event.messages.push({ role: "user", content: _pendingContext })` and returns `{ messages }`. The returned list is used for that request only; the pushed message is not saved to the session.

So turn 2's request ends with `[…, user: "<prompt 2>", user: "<context-mode context>"]`, and turn 2's signed thinking is bound to it. Turn 3 replays `[…, user: "<prompt 2>", assistant: <thinking …>, …]` without the injected text, so `messages.2.content.0` differs from what the signature was made over.

The adapter's comment says the message-based injection was chosen to preserve prefix caching, which it does for the system prompt, but the transient message itself changes the prefix that later turns replay.

A second, smaller source of the same error: `ensureMCPBridge` in `before_agent_start` registers the `ctx_*` tools lazily, so the tool list can differ between the turn that produced a thinking block and a later turn.

## Suggested fix

- Persist the injected context as a session entry, so later turns replay exactly what was sent.
- Or skip the per-request message when the active model is Anthropic with thinking enabled (or put the stable routing anchor in the system prompt once, which is cache-safe because it never changes).
- Or provide a setting or environment variable to turn the Pi `context` injection off. Currently there isn't one, and Pi cannot exclude a single extension, so the only workaround is turning thinking off.
- Register the `ctx_*` tools before the first request, so the tool list stays the same across turns.
