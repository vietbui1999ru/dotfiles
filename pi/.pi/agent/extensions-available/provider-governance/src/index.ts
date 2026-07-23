/**
 * Provider governance extension — Phase 0: observation-only baseline.
 *
 * This extension is loaded by Pi auto-discovery from ~/.pi/agent/extensions/.
 * It does NOT register live custom providers, call pi.setModel(), or
 * claim to observe actual retry execution.
 *
 * Retry reporting scope (per spec §6.1, §6.5):
 *   Reports `configured | unknown` from resolved global settings.
 *   Does NOT report actually observed retry events — Pi 0.80.x extension API
 *   does not expose auto_retry_start/auto_retry_end events (those exist only
 *   on the RPC stdout protocol).
 *
 * Future: RPC-to-extension bridge or Pi core retry event API for live observation.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, loadConfigWithValidation, writeConfig, configPath } from "./config.ts";
import type { RetryLabel } from "./types.ts";
import { info, warn, error, logPath, readRecentLogs, getErrorCounters, clearLog } from "./logger.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { validateConfig, checkRegistrationGate } from "./policy.ts";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  if (!config.governanceEnabled) return;

  // ───────── Commands ─────────

  pi.registerCommand("provider-status", {
    description: "Show provider/model status, retry policy, and warnings",
    handler: async (_args: string, ctx) => {
      try {
        const cfg = loadConfig();
        const validation = validateConfig(cfg);
        const lines: string[] = [];

        lines.push("Provider Governance Status");
        lines.push(`  Config: ${configPath()}`);
        lines.push(`  Enabled: ${cfg.governanceEnabled}`);
        lines.push(`  Live Registration: ${cfg.registrationEnabled ? "ENABLED" : "DISABLED"}`);

        // Show validation errors/warnings
        if (!validation.valid) {
          for (const err of validation.errors) {
            lines.push(`  ⚠ Config error: ${err.field} — ${err.message}`);
          }
        }
        for (const warn of validation.warnings) {
          lines.push(`  ⚠ Config warning: ${warn.field} — ${warn.message}`);
        }

        const retryLabel = resolveRetryLabel();
        lines.push(`    Note: reports configured|unknown only. Pi 0.80.x extension API`);
        lines.push(`    does not expose auto_retry events. See RPC stdout for observed retries.`);

        if (cfg.acpDelegate) {
          lines.push(`  ACP Delegate: ${cfg.acpDelegate.routeEnabled ? "ENABLED" : "DISABLED"}`);
          lines.push(`    Route reports: automatic retry unknown`);
        }

        lines.push("");
        lines.push("Model Registry:");
        const models = ctx.modelRegistry.getAll();
        if (models.length === 0) {
          lines.push("  (no models registered)");
        } else {
          for (const m of models.slice(0, 20)) {
            const billing = m.cost
              ? `cost: i=${m.cost.input}/o=${m.cost.output}`
              : "billing: unknown";
            lines.push(`  ${m.provider}/${m.id}  [${billing}]`);
          }
          if (models.length > 20) {
            lines.push(`  ... and ${models.length - 20} more`);
          }
        }

        ctx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        error("provider-status", "command failed", err);
        ctx.ui.notify(`provider-status error: ${err}`, "error");
      }
    },
  });

  pi.registerCommand("provider-doctor", {
    description: "Run observational diagnostics (no inference)",
    handler: async (_args: string, ctx) => {
      try {
        const { config: cfg, validation } = loadConfigWithValidation();
        const lines: string[] = [];

        lines.push("Provider Doctor");
        lines.push(`  Config file: ${configPath()}`);
        lines.push(`  Config valid: ${validation.valid ? "yes" : "NO — issues found"}`);
        if (!validation.valid) {
          for (const err of validation.errors) {
            lines.push(`    ✗ ${err.field}: ${err.message}`);
          }
        }
        for (const w of validation.warnings) {
          lines.push(`    ⚠ ${w.field}: ${w.message}`);
        }
        lines.push(`  Retry (from global settings):`);
        lines.push(`    governance extension reports: ${resolveRetryLabel()}`);
        lines.push(`    Actual retry events: only visible via RPC stdout`);
        lines.push(`    See: scripts/rpc-retry-probe.ts`);
        lines.push(`  ACP config: ${cfg.acpDelegate ? "present" : "missing — using built-in defaults"}`);
        lines.push(`  Telemetry sink: ${cfg.telemetry?.sink ?? "unset"}`);
        lines.push(`  Registration gate: ${checkRegistrationGate(cfg, false).allowed ? "OPEN" : "BLOCKED"}`);
        lines.push("");
        lines.push("  No inference was sent for diagnostics.");
        lines.push("  No provider was registered or enabled by this command.");

        ctx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        error("provider-doctor", "command failed", err);
        ctx.ui.notify(`provider-doctor error: ${err}`, "error");
      }
    },
  });

  pi.registerCommand("provider-policy", {
    description: "Show provider policy configuration",
    handler: async (_args: string, ctx) => {
      try {
        const cfg = loadConfig();
        const lines: string[] = [];

        lines.push("Provider Policy");
        lines.push(`  Cross-provider fallback: ${cfg.allowAutomaticCrossProviderFallback ? "ALLOWED" : "PROHIBITED"}`);
        lines.push(`  Config scope: ${cfg.configScope}`);
        lines.push(`  Live registration: ${cfg.registrationEnabled ? "ENABLED" : "DISABLED"}`);
        if (cfg.acpDelegate) {
          lines.push(`  ACP default tools: none (allowlist per work-type)`);
          lines.push(`  ACP disallowed: ${cfg.acpDelegate.disallowedTools.join(", ")}`);
          lines.push(`  ACP circuit breaker: finite budgets, zero auto-restart`);
        }

        ctx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        error("provider-policy", "command failed", err);
        ctx.ui.notify(`provider-policy error: ${err}`, "error");
      }
    },
  });

  // ───────── Events (observation-only) ─────────

  pi.on("model_select", async (event, ctx) => {
    try {
      const { model, source } = event;
      const next = `${model.provider}/${model.id}`;

      // Update status bar (advisory only — governance never vetoes model changes)
      ctx.ui.setStatus("model", `${model.id}`);

      // Log non-restore changes
      if (source !== "restore") {
        info("model_select", `model changed to ${next} (${source})`);
      }
    } catch (err) {
      error("model_select", "handler failed", err);
    }
  });

  pi.on("message_end", async (_event, _ctx) => {
    // Observation point only — no transformation or veto
  });

  // Unhandled rejections are caught by Node.js process.on('unhandledRejection')
  // The extension_error event is an RPC protocol event, not an extension lifecycle event.

  // ───────── Logging ─────────

  info("index", "extension loaded", {
    config: configPath(),
    governanceEnabled: config.governanceEnabled,
  });

  pi.registerCommand("provider-logs", {
    description: "Show recent governance extension logs",
    handler: async (_args: string, ctx) => {
      const logs = readRecentLogs(30);
      const counters = getErrorCounters();
      const lines: string[] = [];
      lines.push(`Log file: ${logPath()}`);
      lines.push(`Error counters: ${JSON.stringify(counters)}`);
      lines.push("");
      for (const entry of logs) {
        const marker = entry.level === "ERROR" ? "✗" : entry.level === "WARN" ? "⚠" : "·";
        lines.push(`${marker} [${entry.ts.slice(11, 19)}] ${entry.level} ${entry.source}: ${entry.message}`);
        if (entry.error) lines.push(`  └─ ${entry.error.slice(0, 200)}`);
      }
      ctx.ui.notify(lines.join("\n") || "(no logs)", "info");
    },
  });

  pi.registerCommand("provider-logs-clear", {
    description: "Clear the governance extension log file",
    handler: async (_args: string, ctx) => {
      clearLog();
      info("index", "log cleared by user");
      ctx.ui.notify("Log cleared.", "info");
    },
  });

  // ───────── Config lock ─────────

  // Ensure the config file exists with defaults on first load
  // (writes only if missing — existing config is not silently rewritten)
  writeConfig(config);
}

// ───────── Helpers ─────────

function resolveRetryLabel(): RetryLabel {
  // Phase 0: parse global settings.json for retry defaults.
  // This reads the file directly rather than through an extension API
  // because Pi 0.80.x provides no extension API for effective retry state.
  try {
    const settingsPath = join(homedir(), ".pi", "agent", "settings.json");

    if (!existsSync(settingsPath)) return "unknown";

    const raw = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw);

    const enabled = settings.retry?.enabled;
    const maxRetries = settings.retry?.maxRetries;
    const providerMaxRetries = settings.retry?.provider?.maxRetries;

    if (enabled === false) return "configured"; // deliberately disabled
    if (enabled === true && maxRetries != null && providerMaxRetries != null) {
      return "configured";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
