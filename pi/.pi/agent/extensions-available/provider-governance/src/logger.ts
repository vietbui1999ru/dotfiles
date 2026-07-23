/**
 * Provider governance — error/event logger.
 *
 * Records structured log entries to ~/.pi/agent/provider-governance.log
 * with timestamps, severity, source, and correlation IDs.
 *
 * Log file is append-only. Rotate manually or cap via retention policy.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOG_PATH = join(homedir(), ".pi", "agent", "provider-governance.log");

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: string;       // module or function name
  message: string;
  error?: string;       // serialized error (name + message + stack first frame)
  data?: string;        // compact JSON metadata (never secrets)
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const MIN_LOG_LEVEL: LogLevel =
  (process.env["PROVIDER_GOVERNANCE_LOG_LEVEL"] as LogLevel) ?? "INFO";

let _logFileInitialized = false;

function ensureLogFile(): void {
  if (_logFileInitialized) return;
  const dir = join(homedir(), ".pi", "agent");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _logFileInitialized = true;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const stackLine = err.stack?.split("\n").slice(0, 2).join(" | ") ?? "";
    return `${err.name}: ${err.message} | ${stackLine}`;
  }
  return String(err);
}

function writeEntry(entry: LogEntry): void {
  if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL]) return;

  ensureLogFile();
  const line = JSON.stringify(entry) + "\n";
  try {
    appendFileSync(LOG_PATH, line, "utf8");
  } catch {
    // Last resort: stderr (don't throw — logging must never break the extension)
    process.stderr.write(`[provider-governance] LOG FAILURE: ${line}\n`);
  }
}

/** Core log function. Prefer typed wrappers below. */
function log(level: LogLevel, source: string, message: string, error?: unknown, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    source,
    message,
    error: error ? formatError(error) : undefined,
    data: data ? JSON.stringify(data) : undefined,
  };
  writeEntry(entry);

  // Also echo to stderr for ERROR/WARN so they appear in Pi's crash log
  if (level === "ERROR" || level === "WARN") {
    const tag = level === "ERROR" ? "✗" : "⚠";
    process.stderr.write(`[provider-governance] ${tag} ${source}: ${message}${error ? " — " + formatError(error) : ""}\n`);
  }
}

/** Tracks a labelled error counter for diagnostic display. */
const errorCounters = new Map<string, number>();

export function incrementError(label: string): number {
  const count = (errorCounters.get(label) ?? 0) + 1;
  errorCounters.set(label, count);
  return count;
}

export function getErrorCounters(): Record<string, number> {
  return Object.fromEntries(errorCounters);
}

export function resetErrorCounters(): void {
  errorCounters.clear();
}

/** Get log file path. */
export function logPath(): string {
  return LOG_PATH;
}

/** Read recent log entries for diagnostics. */
export function readRecentLogs(n: number): LogEntry[] {
  try {
    if (!existsSync(LOG_PATH)) return [];
    const raw = readFileSync(LOG_PATH, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-n).map((l) => {
      try {
        return JSON.parse(l) as LogEntry;
      } catch {
        return { ts: "", level: "WARN" as LogLevel, source: "log-reader", message: `unparseable: ${l.slice(0, 80)}` };
      }
    });
  } catch {
    return [];
  }
}

/** Clear the log file. */
export function clearLog(): void {
  try {
    ensureLogFile();
    writeFileSync(LOG_PATH, "", "utf8");
  } catch { /* best-effort */ }
}

// ───── Typed wrappers ─────

export function debug(source: string, message: string, data?: Record<string, unknown>): void {
  log("DEBUG", source, message, undefined, data);
}

export function info(source: string, message: string, data?: Record<string, unknown>): void {
  log("INFO", source, message, undefined, data);
}

export function warn(source: string, message: string, error?: unknown, data?: Record<string, unknown>): void {
  log("WARN", source, message, error, data);
  incrementError(source);
}

export function error(source: string, message: string, err?: unknown, data?: Record<string, unknown>): void {
  log("ERROR", source, message, err, data);
  incrementError(source);
}
