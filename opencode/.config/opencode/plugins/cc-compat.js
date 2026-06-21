import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

// ── Paths ────────────────────────────────────────────────────────────────────

const WIKI_ROOT = join(homedir(), "repos/llm-wiki")
const MISTAKES_LOG = join(WIKI_ROOT, "mistakes/raw-log.md")

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"
}

function appendLine(file, line) {
  try {
    appendFileSync(file, line + "\n")
  } catch { /* non-fatal */ }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export const CcCompatPlugin = async ({ $, client }) => {

  // Track command failures for capture-mistake
  let toolSequence = []

  return {

    // ── Mistake capture ───────────────────────────────────────────────────────
    // After a Bash tool fails, log to raw-log.md.
    // Pattern: 3+ failures of same command type → flag as recurring.

    "tool.execute.after": async (input) => {
      if (input?.tool !== "bash" && input?.tool !== "edit" && input?.tool !== "write") return
      if (!input?.error) return  // only failures

      const cmd = input?.input?.command ?? input?.input?.filePath ?? "unknown"
      const exitCode = input?.error?.type === "permission" ? -1 : (input?.result?.exitCode ?? -1)
      const detail = String(input?.error?.message ?? input?.result?.stderr ?? "").slice(0, 200)

      // Skip known noise
      if (detail.includes("ENOENT") && !cmd.includes("git")) return
      if (exitCode === 0) return

      // Log to raw-log.md
      const line = [
        `- [${now()}] exit:${exitCode}`,
        `  tool=${input.tool} cmd=${cmd}`,
        `  err=${detail}`,
        `  ctx=${client?.session?.id ?? "unknown"}`,
      ].join("\n")
      appendLine(MISTAKES_LOG, line)

      // Track repeating patterns
      toolSequence.push({ tool: input.tool, cmd, ts: Date.now() })
      if (toolSequence.length > 50) toolSequence = toolSequence.slice(-50)

      // Check for 3+ same cmd in last 10 entries
      const recent = toolSequence.slice(-10)
      const repeats = recent.filter(t => t.cmd === cmd).length
      if (repeats >= 3) {
        appendLine(MISTAKES_LOG, [
          `- [${now()}] RECURRING: command failed 3x in last 10`,
          `  cmd=${cmd} — suggests systematic issue`,
        ].join("\n"))
        toolSequence = []  // reset to avoid duplicate alerts
      }
    },

    // ── Approval gate for dangerous operations ────────────────────────────────
    // Block destructive Bash commands and ask for human confirmation.

    "tool.execute.before": async (input) => {
      if (input?.tool !== "bash") return

      const cmd = String(input?.input?.command ?? "")
      const dangerous = [
        "git push --force",
        "git push -f",
        "rm -rf ",
        "rm -fr ",
        "sudo ",
        "chmod 777",
        "DROP TABLE",
        "DROP DATABASE",
        "> /dev/",
        "dd if=",
        "mkfs.",
        "fdisk",
        "pvcreate",
        "vgremove",
      ]

      const matched = dangerous.find(p => cmd.includes(p))
      if (matched) {
        // Instead of blocking, log the attempt and let it proceed
        // OpenCode's permission system handles the actual block
        appendLine(MISTAKES_LOG, [
          `- [${now()}] DANGEROUS_CMD_ATTEMPTED: matched "${matched}"`,
          `  cmd=${cmd.slice(0, 300)}`,
        ].join("\n"))
      }
    },

  }
}
