---
kind: arch
work_type: arch
status: draft
goal: ""
task: ""
tags: []
---

# ARCHITECTURE: {{goal}}

## Related Links

- SPEC: (link or `see: .agents/sessions/<spec-file>`)
- Design: (link or `see: .agents/sessions/<design-file>`)

## Context

- System context, constraints, non-functional requirements

## Architecture Overview (C4 Level 1 — Context)

```mermaid
graph TB
    User[User] --> System[This System]
    System --> External[External Service]
```

## Container Diagram (C4 Level 2)

```mermaid
graph LR
    A[Container A] --> B[Container B]
    B --> C[(Database)]
```

## Component Diagram (C4 Level 3)

```mermaid
graph TD
    Comp1[Component 1] --> Comp2[Component 2]
```

## Decisions

- Decision 1 — why
- Decision 2 — why

## Trade-offs

- Trade-off 1
- Trade-off 2

## Deployment

- How this system deploys (diagrams, scripts, environments)

## Notes

- Tech debt, migration paths, scaling considerations
