---
name: design-brief
description: Overlay on the upstream frontend-design skill. Reads the pinned upstream, then runs plan -> genericness check -> build -> screenshot critique in ship mode, or a guided user loop in learn mode, with a per-project design-log. Invoke for distinctive, intentional frontend work.
---

# Design Brief

An overlay on the `frontend-design` skill. Read `upstream.md` in this directory
first, then apply the overlays below. Where the two disagree, this file wins.

## Read first

1. `upstream.md` — the pinned upstream skill (grounding, design principles,
   process, restraint, and writing guidance). It is the base.
2. `shared/design/taste.md` — the user's own font/palette/reference judgement. It
   is authoritative for taste; the brief's own words win over everything.
3. `shared/design/design-slop.md` — the slop register the write hook enforces.
   Build against it: if a plan trips a pattern, revise before you write code.

## Mode

The default comes from the project's `.claude/profile.md`:

```bash
grep -E '^design-mode:' .claude/profile.md   # ship | learn
```

An argument to `/design-brief` overrides it for this run: `ship`, `learn`, or
`drill`. No argument and no `design-mode:` line — ask the user which mode.

## Ship flow

1. Read the three files above and the design brief.
2. Write the token plan (color 4–6 named hex, type + roles, layout concept with
   ASCII wireframes and alignment guidance, principles) as a new entry in
   `.claude/design-log.md`.
3. **Genericness check.** Ask a different model to plan the same brief:

   ```bash
   pi -p "<brief>: propose a token plan" --model opencode-go/deepseek-v4-pro --no-session --no-extensions --no-skills
   ```

   Diff its plan against ours. Wherever they match, our plan is generic — revise
   that part, and record what changed and why in the design-log entry.
4. Build the UI, following the revised plan.
5. Screenshot with Playwright at 1440px and 375px.
6. Inject axe-core through Playwright `browser_evaluate` from a pinned cdnjs URL
   (e.g. `https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.3/axe.min.js`) and
   run a full `axe.run()` scan; fix every violation before the critique.
7. Spawn an Opus high-effort subagent to critique the screenshots against the
   rubric: distinctiveness, hierarchy, typography, copy, a11y.
8. Run the text rubric with the same deepseek-v4-pro call (token plan + code;
   it gets text only, never images).
9. Log the verdict in the design-log entry.

## Learn flow

1. The user writes the token plan.
2. The agent critiques it against the brief, `taste.md`, and the slop register.
3. The agent builds.
4. The agent screenshots at 1440px and 375px; the user critiques the screenshot.
5. Notes from every step go to `.claude/design-log.md`.

## Drill

`/design-brief drill` runs one typography drill from The Elements of Typographic
Style, covering scale, measure, and leading, and applies the result to the current
work. No plan, no judges — a focused exercise.

## Judges

- **Text and genericness:** `opencode-go/deepseek-v4-pro`. Text only — it cannot
  read images.
- **Screenshots:** an Opus high-effort subagent. Opus handles every image.
- **Never use Gemini as a judge.**

## design-log entry format

Each entry in `.claude/design-log.md` records:

- **date** — when the run happened
- **brief** — the design brief as given
- **token plan** — color, type, layout, principles
- **genericness diff** — where our plan matched the baseline and how we revised it
- **verdict** — the screenshot and text-rubric outcome
- **notes** — what to remember for the next pass

## UX copy

UX copy is an on-disk artifact: write it into the UI files as clear, plain prose.
Do not use caveman shorthand in shipped copy.

## Use-test

A human use-test runs **only when the user asks for one**. The skill never
volunteers or schedules it on its own.
