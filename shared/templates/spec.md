---
kind: spec
work_type: spec
status: draft
goal: ""
task: ""
tags: []
---

# SPEC: {{goal}}

## Objective

- What is being built and why (user-centric, not implementation detail)
- Who will use it? What problem does it solve? What does success look like?

## Tech Stack

- Language, framework, versions, key dependencies (be specific)

## Commands

- Build: `npm run build` (or equivalent)
- Test: `npm test` (or equivalent)
- Lint: `npm run lint` (or equivalent)

## Project Structure

- `src/` — application source code
- `tests/` — unit and integration tests
- `docs/` — documentation

## Code Style

- One real code snippet showing your style beats three paragraphs describing it
- Naming conventions, formatting rules, examples of good output

## Git Workflow

- Branch naming: `feat/`, `fix/`, `refactor/`
- Commit message format
- PR requirements

## Boundaries

### Always

- Run tests before commits
- Follow naming conventions in the style guide

### Ask First

- Database schema changes
- Adding new dependencies
- Changing CI/CD configuration

### Never

- Commit secrets or API keys
- Edit `node_modules/` or vendor directories
- Remove a failing test without explicit approval

## Conformance Criteria

- Must pass all cases in `conformance.yaml`
- Acceptance criteria checklist:

- [ ] Criterion 1
- [ ] Criterion 2

## Notes

- Domain knowledge, gotchas, edge cases
- Link to conformance suite if applicable
