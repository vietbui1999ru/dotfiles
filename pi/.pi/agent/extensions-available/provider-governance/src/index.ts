/**
 * Provider governance extension — Phase 3 observation-first inventory.
 *
 * The extension reads Pi's existing model registry and lifecycle events only.
 * It never registers a provider, selects a model, performs inference, logs in,
 * falls back across providers, or persists message content.
 *
 * Retry reporting is deliberately limited to `configured | unknown`: Pi 0.80.x
 * exposes auto-retry events on RPC stdout, not the extension lifecycle API.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, loadConfigWithValidation, writeConfig, configPath } from "./config.ts";
import type { RetryLabel } from "./types.ts";
import { info, error, logPath, readRecentLogs, getErrorCounters, clearLog } from "./logger.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { validateConfig, checkRegistrationGate, resolveRetryLabel as resolveRetryLabelFromSettings } from "./policy.ts";
import {
  formatProviderStatus,
  inventoryModels,
  isAssistantMessage,
  observeAssistantMessage,
  observeProviderResponse,
  anthropicExtraUsageWarning,
  type HealthObservationInput,
} from "./observation.ts";

let healthByProvider: Record<string, HealthObservationInput> = {};
let selectedModel: string | undefined;
let lastTerminal: ReturnType<typeof observeAssistantMessage>;

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  if (!config.governanceEnabled) return;

  pi.registerCommand("provider-status", {
    description: "Show read-only provider/model status, health, retry policy, and warnings",
    handler: async (_args, ctx) => {
      try {
        const cfg = loadConfig();
        const validation = validateConfig(cfg);
        const retryLabel = resolveRetryLabel();
        const entries = inventoryModels(ctx.modelRegistry.getAll(), retryLabel, healthByProvider);
        const lines = [
          formatProviderStatus(entries, selectedModel, lastTerminal),
          `Config: ${configPath()}`,
          `Enabled: ${cfg.governanceEnabled}`,
          `Live Registration: ${cfg.registrationEnabled ? "ENABLED" : "DISABLED"}`,
          `Retry: ${retryLabel} (configured|unknown only; actual retry events require RPC stdout)`,
        ];
        if (!validation.valid) {
          for (const item of validation.errors) lines.push(`Config error: ${item.field} — ${item.message}`);
        }
        for (const item of validation.warnings) lines.push(`Config warning: ${item.field} — ${item.message}`);
        if (cfg.acpDelegate) lines.push(`ACP Delegate: ${cfg.acpDelegate.routeEnabled ? "ENABLED" : "DISABLED"}; retry=automatic retry unknown`);
        ctx.ui.notify(lines.join("\n"), "info");
      } catch (caught) {
        error("provider-status", "command failed", caught);
        ctx.ui.notify("provider-status failed; see provider-logs.", "error");
      }
    },
  });

  pi.registerCommand("provider-doctor", {
    description: "Run observational provider diagnostics without inference",
    handler: async (_args, ctx) => {
      try {
        const { config: cfg, validation } = loadConfigWithValidation();
        const entries = inventoryModels(ctx.modelRegistry.getAll(), resolveRetryLabel(), healthByProvider);
        const lines = [
          "Provider Doctor",
          `Config file: ${configPath()}`,
          `Config valid: ${validation.valid ? "yes" : "NO — issues found"}`,
          `Providers observed: ${entries.length}`,
          `Retry: ${resolveRetryLabel()} (actual retry events only visible via RPC stdout)`,
          `ACP config: ${cfg.acpDelegate ? "present" : "missing — using built-in defaults"}`,
          `Telemetry sink: ${cfg.telemetry?.sink ?? "unset"}`,
          `Registration gate: ${checkRegistrationGate(cfg, false).allowed ? "OPEN" : "BLOCKED"}`,
          "No inference was sent; no provider was registered or enabled.",
        ];
        for (const item of validation.errors) lines.push(`Config error: ${item.field}: ${item.message}`);
        for (const item of validation.warnings) lines.push(`Config warning: ${item.field}: ${item.message}`);
        ctx.ui.notify(lines.join("\n"), validation.valid ? "info" : "warning");
      } catch (caught) {
        error("provider-doctor", "command failed", caught);
        ctx.ui.notify("provider-doctor failed; see provider-logs.", "error");
      }
    },
  });

  pi.registerCommand("provider-policy", {
    description: "Show provider governance policy configuration",
    handler: async (_args, ctx) => {
      try {
        const cfg = loadConfig();
        const lines = [
          "Provider Policy",
          `Cross-provider fallback: ${cfg.allowAutomaticCrossProviderFallback ? "ALLOWED" : "PROHIBITED"}`,
          `Config scope: ${cfg.configScope}`,
          `Live registration: ${cfg.registrationEnabled ? "ENABLED" : "DISABLED"}`,
          "Diagnostics: observational only; no inference",
        ];
        if (cfg.acpDelegate) {
          lines.push("ACP default tools: none (allowlist per work-type)");
          lines.push(`ACP disallowed: ${cfg.acpDelegate.disallowedTools.join(", ")}`);
          lines.push("ACP circuit breaker: finite budgets, zero auto-restart");
        }
        ctx.ui.notify(lines.join("\n"), "info");
      } catch (caught) {
        error("provider-policy", "command failed", caught);
        ctx.ui.notify("provider-policy failed; see provider-logs.", "error");
      }
    },
  });

  // Post-selection is advisory. There is intentionally no pre-selection veto.
  pi.on("model_select", async (event, ctx) => {
    try {
      const next = `${event.model.provider}/${event.model.id}`;
      selectedModel = next;
      if (ctx.hasUI) ctx.ui.setStatus("provider-governance", event.model.id);
      const warning = anthropicExtraUsageWarning(event.model.provider);
      if (warning && event.source !== "restore" && ctx.hasUI) ctx.ui.notify(warning, "warning");
      if (event.source !== "restore") info("model_select", `model changed to ${next} (${event.source})`);
    } catch (caught) {
      error("model_select", "handler failed", caught);
    }
  });

  // Assistant terminal metadata only: content and error text never enter logs.
  pi.on("message_end", async (event) => {
    if (!isAssistantMessage(event.message)) return;
    const observation = observeAssistantMessage(event.message);
    if (!observation) return;
    lastTerminal = observation;
    info("message_end", "assistant terminal observed", {
      provider: observation.providerId,
      model: observation.modelId,
      status: observation.status,
      stopReason: observation.stopReason,
      input: observation.usage.input,
      output: observation.usage.output,
    });
  });

  // Response lifecycle is observational and does not trigger a health request.
  pi.on("after_provider_response", async (event, ctx) => {
    const providerId = ctx.model?.provider;
    if (!providerId) return;
    healthByProvider = {
      ...healthByProvider,
      [providerId]: observeProviderResponse(event.status),
    };
  });

  info("index", "extension loaded", { config: configPath(), governanceEnabled: config.governanceEnabled });
  pi.registerCommand("provider-logs", {
    description: "Show recent governance extension logs",
    handler: async (_args, ctx) => {
      const logs = readRecentLogs(30);
      const counters = getErrorCounters();
      const lines = [`Log file: ${logPath()}`, `Error counters: ${JSON.stringify(counters)}`, ""];
      for (const entry of logs) {
        let marker = "·";
        if (entry.level === "ERROR") marker = "✗";
        else if (entry.level === "WARN") marker = "⚠";
        lines.push(`${marker} [${entry.ts.slice(11, 19)}] ${entry.level} ${entry.source}: ${entry.message}`);
        if (entry.error) lines.push(`  └─ ${entry.error.slice(0, 200)}`);
      }
      ctx.ui.notify(lines.join("\n") || "(no logs)", "info");
    },
  });

  pi.registerCommand("provider-logs-clear", {
    description: "Clear the governance extension log file",
    handler: async (_args, ctx) => {
      clearLog();
      info("index", "log cleared by user");
      ctx.ui.notify("Log cleared.", "info");
    },
  });

  // Keep the existing global config untouched except for first-run creation.
  if (!existsSync(configPath())) writeConfig(config);
}

function resolveRetryLabel(): RetryLabel {
  try {
    const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
    if (!existsSync(settingsPath)) return "unknown";
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    return resolveRetryLabelFromSettings(settings);
  } catch {
    return "unknown";
  }
}
