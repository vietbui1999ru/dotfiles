import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

// ── helpers ────────────────────────────────────────────────────────────────

function safeRead(path) {
  try { return readFileSync(path, "utf-8") } catch { return "" }
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

// ── plugin ─────────────────────────────────────────────────────────────────
// Two responsibilities:
//   1. experimental.session.compacting → inject .agents/ state into summary
//   2. session.idle → write checkpoint from git + loop state + task list

export const LeanSessionPlugin = async ({ $, directory }) => {
  const agentsDir  = join(directory, ".agents")
  const LOOP_STATE = join(homedir(), ".config/opencode/loop-state.json")

  // Accumulate changed files from session.diff events
  const changedFiles = new Set()

  return {

    // ── compaction hook ──────────────────────────────────────────────────────
    // Fires before LLM generates continuation summary.
    // Injects .agents/ state so it survives context clears.

    "experimental.session.compacting": async (_input, output) => {
      const tasks      = safeRead(join(agentsDir, "tasks.md"))
      const checkpoint = safeRead(join(agentsDir, "checkpoint.md"))
      const decisions  = safeRead(join(agentsDir, "decisions.md"))

      if (!tasks && !checkpoint && !decisions) return

      output.context.push(`
## Session State (auto-injected from .agents/ — read this to resume)

### Active Tasks
${tasks || "_No .agents/tasks.md found_"}

### Last Checkpoint
${checkpoint || "_No checkpoint yet_"}

### Project Decisions
${decisions || "_No decisions recorded_"}
`.trim())
    },

    // ── session.diff tracking ────────────────────────────────────────────────
    // Accumulate which files changed so checkpoint can list them.
    // Defensive: handle multiple possible event shapes.

    "session.diff": async (event) => {
      try {
        if (Array.isArray(event?.files))   event.files.forEach(f => changedFiles.add(f))
        if (Array.isArray(event?.changed)) event.changed.forEach(f => changedFiles.add(f))
        if (typeof event?.path === "string") changedFiles.add(event.path)
      } catch { /* defensive — unknown event shape */ }
    },

    // ── checkpoint writer ────────────────────────────────────────────────────
    // Fires on session.idle (same event workflow.js uses for ralph loop).
    // Both hooks run — workflow.js re-injects task; this writes state.
    // On AFK loops: checkpoint updates each iteration. On task-complete: final write.

    "session.idle": async () => {
      ensureDir(agentsDir)

      // Pull current task from ralph loop state written by workflow.js
      let currentTask = ""
      let loopIter    = 0
      try {
        const st = JSON.parse(readFileSync(LOOP_STATE, "utf-8"))
        currentTask = st.task  || ""
        loopIter    = st.iter  || 0
      } catch { /* no loop state yet */ }

      // Git state — best-effort, non-fatal
      let gitBranch = "", gitStat = "", gitStatus = ""
      try {
        gitBranch = (await $`git -C ${directory} branch --show-current 2>/dev/null`.text()).trim()
        gitStat   = (await $`git -C ${directory} diff --stat HEAD 2>/dev/null`.text()).trim()
        gitStatus = (await $`git -C ${directory} status --short 2>/dev/null`.text()).trim()
      } catch { /* not a git repo or git unavailable */ }

      const tasks    = safeRead(join(agentsDir, "tasks.md"))
      const ts       = new Date().toISOString().slice(0, 16).replace("T", " ")

      const checkpoint = `# Checkpoint — ${ts}

## Current Task
${currentTask || "_No active task in loop state_"}
${loopIter > 0 ? `\nLoop iteration: ${loopIter}` : ""}

## Branch
${gitBranch || "_not a git repo_"}

## Files Changed This Session
${changedFiles.size > 0
  ? [...changedFiles].map(f => `- ${f}`).join("\n")
  : "_none tracked via session.diff_"}

## Git Status
\`\`\`
${gitStatus || "clean"}
\`\`\`

## Git Diff Summary
${gitStat || "_no uncommitted changes_"}

## Active Task List
${tasks || "_create .agents/tasks.md to track tasks_"}

---
_Written by lean-session plugin on session.idle at ${ts}_
`

      writeFileSync(join(agentsDir, "checkpoint.md"), checkpoint, "utf-8")

      // Reset diff tracking for the next idle cycle
      changedFiles.clear()
    },

  }
}
