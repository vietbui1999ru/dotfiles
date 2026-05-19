---
name: security
description: Load security patterns from the personal wiki. Use when reviewing code for vulnerabilities, auditing agent sandboxing, checking for indirect prompt injection, or applying OWASP-level analysis to a codebase or system design.
allowed-tools: "Bash,Read"
---

# Security Patterns

Load security knowledge from the wiki before reviewing or designing secure systems.

## Search

```
qmd query: [{type:'lex', query:'TERM1'}, {type:'vec', query:'TERM2'}]
collection: 'wiki'
minScore: 0.4
```

Key pages by task:

| Task | Wiki pages |
|---|---|
| OWASP / code review | [[concepts/owasp-security-checklist]], [[concepts/ai-code-review]] |
| Agent sandbox controls | [[concepts/agentic-sandbox-controls]] |
| Prompt injection | [[concepts/indirect-prompt-injection]] |
| AI-specific pitfalls | [[concepts/ai-specific-pitfalls]] |
| Web scraping / fingerprinting | [[concepts/web-fingerprinting]], [[concepts/proxy-rotation]] |

## Load pages

```bash
cat ~/repos/llm-wiki/wiki/<path>
# or via qmd MCP: qmd get <path>
```

## Apply

Work through OWASP checklist systematically. Flag: severity (Critical/High/Medium/Low), location, remediation. Cite wiki pages used.
