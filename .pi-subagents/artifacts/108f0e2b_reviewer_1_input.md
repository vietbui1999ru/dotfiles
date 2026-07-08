# Task for reviewer

[Read from: /Users/vietquocbui/dotfiles/plan.md, /Users/vietquocbui/dotfiles/progress.md]

Perform a review-only code audit of /Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/*.ts against Pi extension docs and best practices. Do not modify files. Look for extension API misuse, event names that do not exist, command collisions, too-broad commands, long-running resources in factories, lack of truncation/output control, state/branching issues, and opportunities to split into smaller packages/tools. Return prioritized findings with evidence and smallest safe fixes.

---
**Output:**
Write your findings to exactly this path: /Users/vietquocbui/dotfiles/.pi-subagents/artifacts/outputs/108f0e2b/local-pi-extension-review.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```