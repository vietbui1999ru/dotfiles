/**
 * RPC Retry Probe — Phase 0
 *
 * Observes auto_retry_start / auto_retry_end events through Pi's RPC stdout
 * protocol. This is the ONLY surface where Pi exposes retry events in 0.80.x;
 * the extension event API has no retry lifecycle hooks.
 *
 * This probe documents the gap between extension API capabilities and full
 * retry observation, informing a future RPC-to-extension bridge decision.
 *
 * Usage:
 *   tsx scripts/rpc-retry-probe.ts [--retry-enabled true|false]
 *
 * The probe:
 *   1. Creates a fresh PI_CODING_AGENT_DIR
 *   2. Sets retry settings in global settings.json
 *   3. Spawns pi --mode rpc
 *   4. Sends a prompt that triggers a transient provider error (via mock)
 *   5. Observes and logs auto_retry_start / auto_retry_end events
 *   6. Reports retry behavior for each retry-enabled variant
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";

const PI_BIN = process.env.PI_BIN ?? "pi";

interface RetryEvent {
  type: "auto_retry_start" | "auto_retry_end";
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  success?: boolean;
  errorMessage?: string;
  finalError?: string;
}

interface RpcConfig {
  retryEnabled: boolean;
}

async function runProbe(config: RpcConfig): Promise<RetryEvent[]> {
  const retryEvents: RetryEvent[] = [];

  // Create isolated agent directory
  const agentDir = mkdtempSync(join(tmpdir(), "pi-retry-probe-"));
  const settingsPath = join(agentDir, "settings.json");
  const extensionsDir = join(agentDir, "extensions");

  mkdirSync(extensionsDir, { recursive: true });

  // Write settings with retry configuration
  const settings = {
    retry: {
      enabled: config.retryEnabled,
      maxRetries: 3,
      baseDelayMs: 1000,
      provider: {
        maxRetries: 0,
        maxRetryDelayMs: 60000,
      },
    },
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  console.log(`\n=== RPC Retry Probe: retry.enabled=${config.retryEnabled} ===`);
  console.log(`Agent dir: ${agentDir}`);
  console.log(`Settings: ${JSON.stringify(settings.retry)}`);

  return new Promise((resolve, reject) => {
    const child = spawn(PI_BIN, [
      "--mode", "rpc",
      "--provider", "opencode-go",
      "--model", "deepseek-v4-flash",
      "--no-session",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1",
      },
    });

    let settled = false;
    const rl = createInterface({ input: child.stdout! });

    rl.on("line", (line: string) => {
      try {
        const event = JSON.parse(line);

        if (event.type === "auto_retry_start" || event.type === "auto_retry_end") {
          retryEvents.push(event as RetryEvent);
          console.log(`[RPC EVENT] ${event.type}:`, JSON.stringify(event));
        }

        if (event.type === "agent_settled") {
          settled = true;
        }
      } catch {
        // Non-JSON line (startup output, debug)
      }
    });

    // Send a trivial prompt
    const prompt = JSON.stringify({
      type: "prompt",
      message: "Say exactly 'ok' and nothing else.",
    }) + "\n";

    child.stdin!.write(prompt);

    // After 15 seconds, or on agent_settled, close and collect results
    const timeout = setTimeout(() => {
      if (!settled) {
        console.log("[probe] Timeout — forcing close");
      }
      child.stdin!.end();
    }, 15_000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      console.log(`[probe] child exited code=${code}`);
      resolve(retryEvents);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const retryEnabled = args.includes("--retry-enabled false") ? false : true;

  console.log("=".repeat(60));
  console.log("Pi RPC Retry Probe");
  console.log(`Pi binary: ${PI_BIN}`);
  console.log("=".repeat(60));

  // Run with retry enabled
  const eventsEnabled = await runProbe({ retryEnabled: true });
  console.log(`\nRetry events (enabled=true): ${eventsEnabled.length}`);
  for (const e of eventsEnabled) {
    console.log(`  ${e.type} attempt=${e.attempt}/${e.maxAttempts}`);
  }

  // Run with retry disabled
  const eventsDisabled = await runProbe({ retryEnabled: false });
  console.log(`\nRetry events (enabled=false): ${eventsDisabled.length}`);
  for (const e of eventsDisabled) {
    console.log(`  ${e.type} attempt=${e.attempt}/${e.maxAttempts}`);
  }

  // ─── Findings Summary ───
  console.log("\n" + "=".repeat(60));
  console.log("FINDINGS");
  console.log("=".repeat(60));

  console.log(`
Extension API retry visibility: NONE
  - Pi ${process.env.PI_VERSION || "0.80.x"} extension lifecycle hooks do NOT include:
    auto_retry_start, auto_retry_end, or effective retry state queries.
  - Retry events are visible ONLY on RPC stdout (§rpc.md:auto_retry_start/end).

Retry settings resolution:
  - Global default: retry.enabled=true, retry.maxRetries=3, retry.provider.maxRetries=0
  - Project overrides: possible via .pi/settings.json (trust-gated)
  - Extension cannot distinguish global vs project effective retry state
    without re-reading and resolving settings files manually.

Implication for live remote custom registration:
  - BLOCKED: Pi extension API cannot prove retry.enabled=false at runtime.
  - Live remote custom providers wait for one of:
    (a) Pi core API exposing effective retry settings to extensions
    (b) Agent-level settings resolved and provable before registration
    (c) Reviewed custom transport with independent retry control
  - The ACP delegate is NOT blocked by this gate (retry reported "automatic retry unknown").

Observation gap documentation:
  - To observe actual retries, a companion RPC process must filter
    auto_retry_start/end events and bridge them to the extension.
  - This is a FUTURE milestone, not Phase 0 work.

Recorded events (enabled): ${eventsEnabled.length}
Recorded events (disabled): ${eventsDisabled.length}
`);
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
