/**
 * Config loader for ~/.pi/agent/provider-governance.json
 *
 * Phase 1: adds config validation via the policy module. Every load validates
 * the config and returns validation results alongside the config object.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProviderGovernanceConfig, ConfigValidationResult } from "./types.ts";
import { validateConfig } from "./policy.ts";

/** Config path (for tooling/display). */
export function configPath(): string {
  return CONFIG_PATH;
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "provider-governance.json");

export const DEFAULTS: ProviderGovernanceConfig = {
  governanceEnabled: true,
  registrationEnabled: false,
  configScope: "global-only",
  allowAutomaticCrossProviderFallback: false,
  acpDelegate: {
    routeEnabled: false,
    settingSources: [],
    mcpServers: [],
    additionalDirectories: [],
    defaultTools: [],
    allowedToolsByWorkType: {},
    disallowedTools: ["Bash", "WebFetch", "WebSearch", "AskUserQuestion"],
    systemPromptMode: "append",
    permissionTimeoutMs: 30000,
    allowAlways: false,
    inheritProcessEnv: false,
    environmentAllowlist: ["HOME", "PATH", "TMPDIR", "TERM"],
    limits: {
      wallClockDeadlineMs: 900000,
      maxPromptTurns: 8,
      maxToolCalls: 40,
      maxRepeatedAction: 3,
      maxRepeatedError: 3,
      maxPermissionDenials: 2,
      maxPolicyViolations: 1,
      maxOutputBytes: 10485760,
      maxSubprocessRestarts: 0,
    },
  },
  telemetry: {
    sink: "bounded-spool",
    spoolRetentionDays: 30,
  },
};

/** Merge user config over defaults. Missing keys always default. */
export function loadConfig(): ProviderGovernanceConfig {
  if (!existsSync(CONFIG_PATH)) {
    return structuredClone(DEFAULTS);
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const user = JSON.parse(raw) as Partial<ProviderGovernanceConfig>;
    return deepMerge(structuredClone(DEFAULTS), user);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

/**
 * Load config and validate it.
 * Returns both the config and validation results.
 */
export function loadConfigWithValidation(): { config: ProviderGovernanceConfig; validation: ConfigValidationResult } {
  const config = loadConfig();
  const validation = validateConfig(config);
  return { config, validation };
}

/** Write config (creates parent dirs). */
export function writeConfig(config: ProviderGovernanceConfig): void {
  const dir = join(homedir(), ".pi", "agent");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function deepMerge(base: ProviderGovernanceConfig, override: Partial<ProviderGovernanceConfig>): ProviderGovernanceConfig {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const val = (override as unknown as Record<string, unknown>)[key];
    if (val !== undefined) {
      if (
        typeof val === "object" &&
        val !== null &&
        !Array.isArray(val)
      ) {
        (result as unknown as Record<string, unknown>)[key] = {
          ...((base as unknown as Record<string, unknown>)[key] as Record<string, unknown>),
          ...(val as Record<string, unknown>),
        };
      } else {
        (result as unknown as Record<string, unknown>)[key] = val;
      }
    }
  }
  return result;
}
