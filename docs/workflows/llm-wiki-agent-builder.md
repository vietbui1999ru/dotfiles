# LLM-Wiki Agent Builder Workflow

The llm-wiki extension has one capability:

```text
/build-agent <request>
```

It creates a new, non-duplicate Pi-first agent blueprint using bounded context
from `~/repos/llm-wiki`.

## What it does

1. Parses the requested agent mission.
2. Checks AgentOps and configured agent directories for duplicates.
3. Searches only the relevant wiki concepts.
4. Generates one concise draft blueprint.
5. Writes it to AgentOps by default.
6. Reports exact wiki citations and open questions.

Default output:

```text
~/repos/AgentOps/Projects/Agents/<slug>.md
```

## What it does not do

The extension does not provide general-purpose:

- wiki search;
- security audits;
- code review;
- planning;
- brainstorming;
- agent installation;
- provider/model selection;
- harness configuration changes.

The wiki remains the data source. The builder is the only generation workflow.

## Example

```text
/build-agent Create a focused TypeScript API contract reviewer.
```

Expected behavior:

```text
Checking for existing agent...
Searching wiki: agent harness, tool design, verification pipeline...
Generating new draft...

Created:
~/repos/AgentOps/Projects/Agents/typescript-api-contract-reviewer.md

Status: draft — review before installation
Sources:
- [[concepts/agent-harness]]
- [[concepts/tool-design-for-agents]]
- [[concepts/verification-pipeline]]
```

## Duplicate behavior

If an existing agent has the same or materially overlapping responsibility, the
builder stops instead of creating a second agent:

```text
Existing agent found: <path>
Overlap: <reason>
Refine the mission or explicitly request replacement.
```

Existing files are never overwritten by default.

## Context limits

The builder intentionally uses small bounded lookups:

```text
wiki queries:          2 maximum
wiki pages:            3 maximum
wiki source content:   12,000 characters maximum
blueprint:             1,200 tokens target
raw logs/transcripts:  never loaded
```

It does not preload the full wiki index or all agent definitions.

## Blueprint review

Every generated agent starts as:

```yaml
status: draft
target: pi
```

Review before installing or adapting it. Confirm:

- mission is narrow;
- non-goals are explicit;
- tools are minimal;
- output contract is testable;
- failure behavior is safe;
- wiki citations support the design;
- no duplicate agent already exists.

## Canonical documentation

- SPEC: `docs/SPEC-llm-wiki-agent-builder.md`
- Skill: `llm-wiki-plugin/skills/build-agent/SKILL.md`
- Wiki source: `~/repos/llm-wiki`
- Agent output: `~/repos/AgentOps/Projects/Agents/`
