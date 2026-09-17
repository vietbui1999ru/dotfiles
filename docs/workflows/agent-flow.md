# Agent Flow — Work Order

Status: ready, 2026-09-16. **Depends on `consolidation-fixes.md` items 1–3** (slice 4 below
auto-chains agents; that is only safe once the review gate fails closed).

## Problem

The developer runs Claude Code (planning, research, review) and Pi (build/test loop, Codex as
model provider) side by side and has ADHD. Flow breaks at three points: **returning after a
wait** (an agent finishes and nothing surfaces it), **deciding what's next**, and **finding the
right window**. Moving data between agents is not a pain point; attention is.

Evidence this matters: ADHD developers report context-switching trouble at OR=3.1 vs
neurotypical developers, with waiting on builds/tests a named trigger, and the study's proposed
intervention is signaling completion rather than making people poll (Newman et al., ICSE'25).
Externalizing state is the most common effective strategy (11/19 interviewees, Bernardo et al.,
arxiv 2312.05029).

## Decisions

1. **herdr owns agent panes; tmux owns everything else** (editor, servers, logs). herdr already
   tracks agent state across Claude, Pi and Codex.
2. **What's next is shown in an always-visible sketchybar pill**, not a notification or a
   dashboard to remember to open.
3. **Attention: quiet first, escalate once if ignored**, never repeatedly.
4. **Auto-chain inside a phase, human gate between phases.** The PR gate stays.
5. **No live agent-to-agent protocol** (A2A/MCP bridge). For a two-agent solo setup, herdr prompts
   plus files in git are enough; a protocol layer is weeks of upkeep for no gain.

## Design constraint: upkeep is the failure mode

Self-built productivity systems tend to be abandoned once novelty fades (weak evidence: one
marketing blog cites 10–14 days). Named failure modes from ADHD practitioner writing:
setup-as-procrastination, manually-maintained state that drifts stale, and feature creep.
Therefore:

- **Nothing in this system is hand-updated.** Every displayed value is derived from herdr events.
- **Build in slices, and stop after each one.** Use slices 1–2 for a week before starting 3–4.
- **Timebox each slice to about an hour of build time.** Ship it imperfect and use it.

## Mechanism

herdr exposes a socket API with `events.subscribe`, including:
- `PaneAgentStatusChangedEvent` — `agent`, `agent_status` (`idle|working|blocked|done|unknown`),
  `workspace_id`, `pane_id`, `title`.
- `PaneOutputMatchedEvent` — a pane's output matched a pattern; carries `matched_line`.

A single small bridge daemon subscribes to these and drives sketchybar via
`sketchybar --trigger`. Event-driven, no polling. Inspect the contract with
`herdr api schema --json`.

What herdr does and does not provide (verified from local `--help`, `herdr --skill`, and the
API schema; prompt delivery itself was not exercised against a live pane):

- **No agent-to-agent message channel.** The schema has no mailbox or message method.
  Cross-agent communication is `agent.prompt` / `agent.send_keys` (write to a pane) plus
  `agent.read` / `agent.wait` / `events.subscribe` (observe a pane).
- **`herdr agent prompt <target> "<text>"` is keystroke injection:** it types the text into the
  target pane and submits Enter, exactly as a human typing there. Targets are a live agent name
  or pane id (e.g. `w3:p1`) and work across workspaces on the same herdr server.
- **Busy targets are not guarded.** herdr rejects a prompt with `agent_blocked` if the target is
  at an approval/question prompt, but nothing prevents injecting into an agent that is
  `working` — the text lands in its input mid-run.
- **No delivery acknowledgement.** `--wait` can return `agent_prompt_stalled` or time out even
  when the text was written; herdr's own guidance is not to blindly resubmit.
- **No trust boundary.** herdr does not sanitize prompt text. Anything one agent's output
  contributes to another agent's prompt is executed as instructions.

Claude Code's own cross-session messaging only reaches other Claude Code sessions and cannot
reach Pi, so herdr is the only available bridge between the two.

## Slice 1 — see state, jump to it

1. **Update integrations.** All are outdated (Pi v6<v8, Claude v7<v9, Codex v6<v8), which is a
   likely cause of unreliable state detection. Run `herdr integration install pi`, `claude`,
   `codex`, then `herdr integration status`. These files are herdr-managed and get overwritten
   on reinstall, so **do not stow them**; add `herdr integration install …` to
   `scripts/bootstrap-dirs.sh` and document them in the README as herdr-managed. This also
   resolves consolidation Phase 5's "unmanaged herdr files" item.
2. **Fixed layout.** Two herdr workspaces with stable labels: `plan` (Claude Code) and `build`
   (Pi). Always the same names, so the pill and click targets never change.
3. **Bridge daemon** — `scripts/herdr-sketchybar-bridge`. Subscribes to agent status events and
   triggers a sketchybar event, e.g. `sketchybar --trigger agent_state AGENT=pi STATUS=done`.
   Run it as a launchd LaunchAgent with KeepAlive so it survives crashes without attention.
   Reconnect with backoff if the herdr socket isn't up yet at login.
4. **sketchybar `agents` item** in `sketchybar/.config/sketchybar/`. Shows one glyph per role,
   e.g. `plan ● working │ build ✓ done`. Click focuses that agent: `herdr agent focus <pane>`
   plus `aerospace workspace T`. **The item changes the right pill's width, so its plugin must
   call `plugins/balance_pills.sh`**, like `aerospace.sh` and `vpn.sh` already do.

Done when: finishing a Pi run changes the pill within a second, and clicking it lands on Pi's pane.

## Slice 2 — the next step

1. **Convention:** every agent ends every run with exactly one line, `NEXT: <action> [plan|build|you]`.
   Add it to `shared/AGENTS.md` (Pi/Codex) and the Claude `core.md` rule.
2. **Capture:** the bridge subscribes to output matches and shows the latest `NEXT:` line in the
   pill. Request shape, from the schema (`match.type` is `substring` or `regex`):

   ```json
   {"method": "events.subscribe", "params": {"subscriptions": [
     {"type": "pane.output_matched", "pane_id": "w3:p1",
      "source": "recent_unwrapped", "strip_ansi": true,
      "match": {"type": "regex", "value": "^NEXT: "}}
   ]}}
   ```

   Subscribe once per agent pane. The event carries `matched_line`. Resolve pane ids from
   `herdr agent list` at startup and again whenever a status event names an unknown pane, since
   pane ids change when panes are recreated.
3. **Fallback for a missing NEXT line:** a rule is not reliable enforcement. If an agent reaches
   `done` or `idle` without printing one, the pill shows `done — no next step`. The gap is
   visible instead of silent.

## Slice 3 — escalate once

The bridge records when each agent entered `done` or `blocked`. If that agent's pane hasn't been
focused within N minutes (default 5, configurable), escalate **once**: sketchybar pulse animation
plus one `herdr notification show`. Reset on focus or state change. Never escalate twice for the
same state change.

## Slice 4 — auto-chain within a phase

**Precondition: `consolidation-fixes.md` items 1–3 are done.**

The **bridge enforces phase boundaries, not the agents.** Pi has already skipped a written gate
in a work order once, so a boundary that depends on an agent obeying an instruction is not a
boundary.

Routing, driven by `NEXT:` targets:
- `[plan]` from Pi → bridge runs `herdr agent prompt <plan pane> "…"`, e.g. review a named commit
  against a named work-order phase.
- `[build]` from Claude → bridge prompts Pi with the fixes to make.
- `[you]` from either → chain stops; pill shows `Phase N ready — approve?`.

**The bridge is the only sender.** herdr injects `HERDR_PANE_ID` and related variables into
every pane, so agents could run `herdr agent prompt` themselves. They must not: the guards
below only hold if every cross-agent prompt goes through the bridge. Add this to
`shared/AGENTS.md` and the Claude `core.md` rule. This is a rule, not enforcement: herdr cannot
distinguish an agent's own `herdr agent prompt` call from a human typing in the pane, so the
bridge cannot detect violations.

Prompt guards, enforced by the bridge because herdr enforces none of them:

1. **Only prompt an idle target.** Immediately before `herdr agent prompt`, read the target's
   current `agent_status`. Send only if it is `idle` or `done`. If it is `working` or `blocked`,
   do not send; hold the handoff and retry when a `pane.agent_status_changed` event reports
   `idle`/`done`. This closes the gap where herdr would type into a running agent.
2. **At most one prompt per state change.** Key each handoff on the source agent's
   `state_change_seq`. Record it before sending; never send twice for the same sequence number.
3. **No blind retries.** If `--wait` stalls or times out, do not resubmit — delivery may have
   succeeded. Route to `[you]` with the pill showing `handoff unconfirmed`.
4. **Never paste agent output into a prompt.** A prompt the bridge sends contains only a fixed
   template plus file paths, commit hashes, and a work-order phase reference, e.g.
   `Review commit 4f2a9c1 against docs/workflows/consolidation-fixes.md item 3. End with NEXT:`.
   The `NEXT:` action text is shown to you in the pill but is never forwarded into another
   agent's prompt. Validate that referenced paths exist in the repo and commits exist in
   `git log` before sending; drop the handoff to `[you]` if not.

Handoff content rules: **reference files and commits, never paste them**, and the receiver must
verify the reference against the actual repo before acting, since a stale plan is not authority.

Hard limits, enforced by the bridge: at most 3 plan↔build round-trips per phase, mirroring
post-run-verifier's 3-cycle cap. At the limit the chain stops and routes to `[you]`. The bridge
never prompts across a phase boundary.

**Human diff review:** `agent-review.md` adds a pending-review state. A pending review makes Pi
not-idle for the bridge regardless of herdr status: no prompts to Pi and no chaining of Pi's
`NEXT:` until the review is decided. Review-driven fix runs don't count toward the round-trip
cap. When dispatching an approved phase, the bridge sets review mode from the phase's `Review:`
line (`setBy: "bridge"`). The pill shows `build ⧗ review N files`, and a pending review escalates
like `blocked` (slice 3).

## Optional — parking lot

A one-keystroke way to dump an intrusive thought instead of following it: e.g. an AeroSpace
binding or shell function `park "…"` appending a timestamped line to a single file. Evidence:
externalizing is the most-reported effective strategy. Upkeep near zero. Adopt only if wanted.

## Rejected

- **corral / Batty / vibe-kanban** (tmux multi-agent tools) — herdr already covers this; adding
  one is the sprawl the consolidation removes.
- **A2A or MCP agent-to-agent bridge** — protocol upkeep without benefit at two agents.
- **Handoff packet file** — git commits plus work-order docs already carry the packet; slice 4's
  reference-don't-paste rule captures the useful part.
- **Hand-maintained status or dashboards** — drift stale; every displayed value here is derived.

## Verification

### Live bridge verification — 2026-09-16

- Launchd recovery: `launchctl kill SIGTERM gui/501/com.vietbui.herdr-sketchybar-bridge`
  replaced bridge PID `25675` with `29525`; the replacement logged
  `subscription_started`.
- Real Pi output: the sole `build` pane (`w3:p1`) ended a normal run with
  `NEXT: verify single-build-pane final handoff capture [you]`.
- Within the next one-second observation window, the pill rendered:
  `plan ○ idle │ build ● working │ build: NEXT: verify single-build-pane final handoff capture [you]`.
- The bridge log recorded `rebuilding subscriptions: completed pane w3:p1`
  followed by `subscription_started`, confirming the recovered bridge received
  the post-restart completion.

- Slice 1: kill the bridge process; launchd restarts it and the pill recovers.
- Slice 2: a run that ends without `NEXT:` shows the fallback text.
- Slice 3: ignore a finished agent past N minutes; exactly one escalation fires.
- Slice 4: a phase that exceeds 3 round-trips stops and routes to `[you]`; a phase boundary never
  triggers a prompt on its own.
- Slice 4 guards, tested against a scratch herdr pane, never a live working session:
  - handoff while the target is `working` → nothing is sent until it reaches `idle`/`done`;
  - duplicate status event with the same `state_change_seq` → exactly one prompt;
  - `--wait` timeout → no resubmission, pill shows `handoff unconfirmed`;
  - a `NEXT:` line containing instructions → does not appear in the sent prompt;
  - a reference to a nonexistent path or commit → handoff routes to `[you]`, nothing is sent.
