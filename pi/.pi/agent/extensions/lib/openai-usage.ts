import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OpenAIUsageConfig {
	enabled?: boolean;
	hourlyCostLimit?: number;
	dailyCostLimit?: number;
	weeklyCostLimit?: number;
	monthlyCostLimit?: number;
}

export interface OpenAIUsageWindow {
	label: "1h" | "24h" | "7d" | "30d";
	cost: number;
	limit?: number;
	percent?: number;
}

export interface OpenAIUsageSummary {
	windows: OpenAIUsageWindow[];
	sessions: number;
}

const WINDOWS: Array<{
	label: OpenAIUsageWindow["label"];
	ms: number;
	limit: keyof Pick<
		OpenAIUsageConfig,
		| "hourlyCostLimit"
		| "dailyCostLimit"
		| "weeklyCostLimit"
		| "monthlyCostLimit"
	>;
}> = [
	{ label: "1h", ms: 60 * 60 * 1000, limit: "hourlyCostLimit" },
	{ label: "24h", ms: 24 * 60 * 60 * 1000, limit: "dailyCostLimit" },
	{ label: "7d", ms: 7 * 24 * 60 * 60 * 1000, limit: "weeklyCostLimit" },
	{ label: "30d", ms: 30 * 24 * 60 * 60 * 1000, limit: "monthlyCostLimit" },
];

function isOpenAIModel(model: unknown): boolean {
	if (typeof model !== "string") return false;
	const normalized = model.toLowerCase();
	return (
		normalized.includes("openai") ||
		/(?:^|[/:_-])(?:gpt|codex|o[1-9])(?:[/:_.-]|$)/.test(normalized)
	);
}

export function formatCost(usd: number): string {
	if (!Number.isFinite(usd) || usd <= 0) return "$0";
	if (usd < 0.01) return `$${usd.toFixed(3)}`;
	if (usd < 10) return `$${usd.toFixed(2)}`;
	return `$${Math.round(usd)}`;
}

export async function readOpenAIUsage(
	cwd: string,
	config: OpenAIUsageConfig = {},
): Promise<OpenAIUsageSummary | undefined> {
	if (config.enabled === false) return undefined;

	const dirs = [join(cwd, ".pi", "status"), join(homedir(), ".pi", "status")];
	const bySession = new Map<string, { ts: number; cost: number }>();
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		for (const file of await readdir(dir)) {
			if (!file.endsWith(".json")) continue;
			try {
				const data = JSON.parse(await readFile(join(dir, file), "utf8")) as {
					sessionId?: unknown;
					model?: unknown;
					updatedAt?: unknown;
					startedAt?: unknown;
					cost?: unknown;
				};
				if (!isOpenAIModel(data.model)) continue;
				const sessionId = String(data.sessionId || file);
				const ts = Date.parse(String(data.updatedAt || data.startedAt || ""));
				const cost = Number(data.cost ?? 0);
				if (!Number.isFinite(ts) || !Number.isFinite(cost)) continue;
				const previous = bySession.get(sessionId);
				if (!previous || ts > previous.ts)
					bySession.set(sessionId, { ts, cost });
			} catch {
				// Ignore an incomplete status write or malformed record.
			}
		}
	}

	if (bySession.size === 0) return undefined;
	const now = Date.now();
	return {
		sessions: bySession.size,
		windows: WINDOWS.map(({ label, ms, limit: limitKey }) => {
			let cost = 0;
			for (const session of bySession.values()) {
				if (now - session.ts <= ms) cost += session.cost;
			}
			const limit = config[limitKey];
			return {
				label,
				cost,
				...(typeof limit === "number" && limit > 0
					? { limit, percent: (cost / limit) * 100 }
					: {}),
			};
		}),
	};
}
