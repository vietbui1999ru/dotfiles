import { readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

// ── state ──────────────────────────────────────────────────────────────────
// Persists across process restarts so iteration count survives session resume.

const STATE_FILE = join(homedir(), ".config/opencode/loop-state.json")
const COMPLETION_TAG = "<task-complete>"
const MAX_ITER = 50

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")) }
  catch { return { iter: 0, task: "" } }
}

function saveState(s) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))
}

// Extract plain text from a message part (string or OpenCode content array).
function extractText(content) {
  if (typeof content === "string") return content
  if (Array.isArray(content))
    return content.map(p => p.text ?? p.content ?? "").join("")
  return ""
}

// ── plugin ─────────────────────────────────────────────────────────────────

export const WorkflowPlugin = async ({ $, client }) => {
  // In-memory last assistant message — valid for current session lifetime.
  // session.idle always fires after all message.updated events complete,
  // so this will be the full final content by the time the loop checks it.
  let lastAssistantMsg = ""

  return {

    // ── message tracking ────────────────────────────────────────────────────
    // Reset iteration count on each new user message (new task).
    // Track last assistant content to detect completion tag.

    "message.updated": async (input) => {
      if (!input?.role) return

      if (input.role === "user") {
        const text = extractText(input.content ?? "")
        if (!text.trim()) return
        saveState({ iter: 0, task: text })
      }

      if (input.role === "assistant") {
        lastAssistantMsg = extractText(input.content ?? "")
      }
    },

    // ── wiki publish hook ───────────────────────────────────────────────────
    // Mirrors Claude's PostToolUse Bash hook: after any shell command,
    // check if log.md changed in ~/repos/llm-wiki and publish if so.

    "tool.execute.after": async (input) => {
      const bashTools = ["bash", "shell", "run_command"]
      if (!bashTools.includes(input?.tool)) return
      try {
        const diff = await $`git -C ${homedir()}/repos/llm-wiki diff --name-only HEAD 2>/dev/null`.text()
        if (diff.includes("log.md")) {
          await $`${homedir()}/repos/llm-wiki/scripts/publish-ai-kb.sh`.quiet()
        }
      } catch { /* non-fatal — wiki publish is best-effort */ }
    },

    // ── ralph loop ──────────────────────────────────────────────────────────
    // Always-on: fires on every session.idle.
    // Exits when the agent includes <task-complete> in its response.
    // Re-injects the original user message as the continuation prompt.

    "session.idle": async (input) => {
      const st = loadState()
      if (!st.task) return  // no task recorded yet

      // Agent signalled completion — reset iter count, stay quiet.
      if (lastAssistantMsg.includes(COMPLETION_TAG)) {
        saveState({ iter: 0, task: st.task })
        return
      }

      // Safety ceiling — stop looping and surface the count.
      if (st.iter >= MAX_ITER) {
        saveState({ iter: 0, task: "" })
        await client.session.prompt(
          `Loop hit ${MAX_ITER} iteration limit without seeing ${COMPLETION_TAG}. ` +
          `Stopping. If the task is actually done, include ${COMPLETION_TAG} in your next reply.`
        )
        return
      }

      st.iter++
      saveState(st)

      await client.session.prompt(
        `[Loop ${st.iter}/${MAX_ITER}] The task is not yet complete — ` +
        `${COMPLETION_TAG} was not found in your last response.\n\n` +
        `Continue working on:\n${st.task}\n\n` +
        `When fully done, end your response with ${COMPLETION_TAG}.`
      )
    },

  }
}
