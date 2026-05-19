---
name: agent-patterns
description: Load agent engineering patterns from the personal wiki. Use when designing multi-agent workflows, choosing between skills/subagents/teams, reasoning about context management, harness architecture, or tool design for agents.
allowed-tools: "Bash,Read"
---

# Agent Patterns

Load agent engineering knowledge from the wiki before designing or reviewing agent systems.

## Search

```
qmd query: [{type:'lex', query:'TERM1'}, {type:'vec', query:'TERM2'}]
collection: 'wiki'
minScore: 0.4
```

Key concept pages to load based on task:

| Task | Wiki pages to load |
|---|---|
| Choosing skill vs subagent vs team | [[syntheses/agent-primitive-selection]], [[concepts/agent-skills]], [[concepts/agent-subagents]], [[concepts/agent-teams]] |
| Context filling / degradation | [[concepts/context-degradation]], [[concepts/context-compression]] |
| Long-horizon loops | [[concepts/agent-harness]], [[concepts/ralph-loop]] |
| Tool design | [[concepts/tool-design-for-agents]] |
| Quality verification | [[concepts/verification-pipeline]] |
| Security | [[concepts/agentic-sandbox-controls]], [[concepts/indirect-prompt-injection]] |
| Plugin/skill architecture | [[concepts/claude-code-plugins]], [[concepts/agent-skills]] |

## Load pages

```bash
cat ~/repos/llm-wiki/wiki/<path>
# or via qmd MCP: qmd get <path>
```

## Apply

Cite loaded pages. Flag gaps as `WIKI-CANDIDATE: <pattern>`.
