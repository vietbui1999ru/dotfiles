# Task for scout

Review the Pi customization setup in /Users/vietquocbui/dotfiles and /Users/vietquocbui/.pi/agent for pi extensions, skills, prompt/templates, package settings, and subagent/agent-related configuration. Do not modify files. Focus on: what exists, overlap/duplication, rough architecture, high-risk issues, and opportunities to atomize/simplify usage for Pi's philosophy. Important files likely include /Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/*.ts, /Users/vietquocbui/.pi/agent/settings.json, and /Users/vietquocbui/.agents/skills/*. Return concise findings with file paths and concrete refactor suggestions.

---
**Output:**
Write your findings to exactly this path: /Users/vietquocbui/dotfiles/.pi-subagents/artifacts/outputs/108f0e2b/local-pi-customization-scout.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

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