import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const REVIEW_GATE_SUSPEND_EVENT = "review-gate:suspend";
export const REVIEW_GATE_BEGIN_PUBLICATION_EVENT = "review-gate:begin-publication";
export const REVIEW_GATE_END_PUBLICATION_EVENT = "review-gate:end-publication";
export const REVIEW_GATE_BEGIN_REPLACEMENT_EVENT = "review-gate:begin-replacement";
export const REVIEW_GATE_VALIDATE_EVENT = "review-gate:validate-suspension";
export const REVIEW_GATE_RESUME_EVENT = "review-gate:resume";

export type SuspensionPhase = "acquired" | "publishing" | "restore-only";

export type ReviewGateSuspendResult =
	| { ok: true; token: string; wasEnabled: boolean; pendingBatches: 0; expiresAt: number }
	| { ok: false; error: string };

export type ReviewGatePublicationResult =
	| { ok: true; token: string; signal: AbortSignal; expiresAt: number }
	| { ok: false; error: string };

export type ReviewGateControlResult =
	| { ok: true; enabled: boolean; phase?: SuspensionPhase; expiresAt?: number }
	| { ok: false; error: string };

export interface ReviewGateSuspendPayload {
	reason: "clear-context-checkpoint";
	ctx: ExtensionContext;
	ttlMs: number;
	publicationDeadlineMs: number;
}

export interface ReviewGateTokenPayload {
	token: string;
	ctx: ExtensionContext;
}

export interface ReviewGateEndPublicationPayload extends ReviewGateTokenPayload {
	success: boolean;
}

export interface ReviewGateResumePayload extends ReviewGateTokenPayload {
	boundaryCrossed: boolean;
}

export class SyncControlRequest<Payload, Result> {
	readonly requestId = randomUUID();
	readonly payload: Readonly<Payload>;
	private state: "open" | "handling" | "closed" = "open";
	private value: Result | undefined;
	private readonly failure: (message: string) => Result;

	constructor(payload: Payload, failure: (message: string) => Result) {
		this.payload = Object.freeze({ ...(payload as Record<string, unknown>) }) as Readonly<Payload>;
		this.failure = failure;
	}

	tryHandle(handler: () => Result): boolean {
		if (this.state !== "open") return false;
		this.state = "handling";
		try {
			const result = handler();
			if (result && typeof (result as { then?: unknown }).then === "function") {
				this.value = this.failure("Review-gate control handlers must be synchronous");
			} else {
				this.value = result;
			}
		} catch (error) {
			this.value = this.failure(error instanceof Error ? error.message : String(error));
		} finally {
			// A first claim is terminal even when the handler is invalid or throws.
			this.state = "closed";
		}
		return true;
	}

	close(): void {
		if (this.state === "open") this.state = "closed";
	}

	get result(): Result | undefined {
		return this.value;
	}
}

interface ActiveSuspension {
	token: string;
	wasEnabled: boolean;
	phase: SuspensionPhase;
	expiresAt: number;
	publicationDeadlineMs: number;
	expired: boolean;
	outerTimer?: ReturnType<typeof setTimeout>;
	publicationTimer?: ReturnType<typeof setTimeout>;
	publicationController?: AbortController;
}

export class ReviewGateSuspensionController {
	private active?: ActiveSuspension;
	private readonly restoreEnabled: (enabled: boolean) => void;
	private readonly now: () => number;

	constructor(restoreEnabled: (enabled: boolean) => void, now: () => number = Date.now) {
		this.restoreEnabled = restoreEnabled;
		this.now = now;
	}

	isActive(): boolean {
		return Boolean(this.active);
	}

	phase(): SuspensionPhase | undefined {
		return this.active?.phase;
	}

	suspend(wasEnabled: boolean, ttlMs: number, publicationDeadlineMs: number): ReviewGateSuspendResult {
		if (this.active) return { ok: false, error: "Review gate already has an active suspension" };
		if (!Number.isFinite(ttlMs) || ttlMs < 1_000 || ttlMs > 120_000) {
			return { ok: false, error: "Invalid review-gate suspension TTL" };
		}
		if (!Number.isFinite(publicationDeadlineMs) || publicationDeadlineMs < 100 || publicationDeadlineMs >= ttlMs) {
			return { ok: false, error: "Publication deadline must be shorter than the suspension lease" };
		}
		const token = randomUUID();
		const expiresAt = this.now() + ttlMs;
		const active: ActiveSuspension = {
			token,
			wasEnabled,
			phase: "acquired",
			expiresAt,
			publicationDeadlineMs,
			expired: false,
		};
		active.outerTimer = setTimeout(() => this.expire(token), ttlMs);
		this.active = active;
		return { ok: true, token, wasEnabled, pendingBatches: 0, expiresAt };
	}

	beginPublication(token: string): ReviewGatePublicationResult {
		const active = this.match(token, "acquired");
		if (!active) return { ok: false, error: "Invalid or inactive review-gate suspension" };
		if (active.expired || this.now() >= active.expiresAt) {
			this.restoreState(active);
			return { ok: false, error: "Review-gate suspension expired before publication" };
		}
		if (active.publicationDeadlineMs >= active.expiresAt - this.now()) {
			return { ok: false, error: "Insufficient suspension lease remaining for publication" };
		}
		active.phase = "publishing";
		active.publicationController = new AbortController();
		active.publicationTimer = setTimeout(() => {
			const current = this.active;
			if (!current || current.token !== token || current.phase !== "publishing") return;
			current.expired = true;
			current.publicationController?.abort(new Error("Review-gate publication deadline expired"));
		}, active.publicationDeadlineMs);
		return { ok: true, token, signal: active.publicationController.signal, expiresAt: active.expiresAt };
	}

	endPublication(token: string, success: boolean): ReviewGateControlResult {
		const active = this.match(token, "publishing");
		if (!active) return { ok: false, error: "No matching publication is active" };
		this.clearPublication(active);
		if (!success || active.expired || this.now() >= active.expiresAt) {
			const enabled = active.wasEnabled;
			this.restoreState(active);
			return { ok: false, error: "Publication failed or expired; review gate restored" };
		}
		active.phase = "acquired";
		return { ok: true, enabled: false, phase: active.phase, expiresAt: active.expiresAt };
	}

	beginReplacement(token: string): ReviewGateControlResult {
		const active = this.match(token, "acquired");
		if (!active) return { ok: false, error: "Invalid review-gate suspension for replacement" };
		if (active.expired || this.now() >= active.expiresAt) {
			this.restoreState(active);
			return { ok: false, error: "Review-gate suspension expired before replacement" };
		}
		if (active.outerTimer) clearTimeout(active.outerTimer);
		active.outerTimer = undefined;
		active.phase = "restore-only";
		// No forward operation is permitted after this point. Exact restoration
		// remains available until session_shutdown crosses the lifecycle boundary.
		return { ok: true, enabled: false, phase: active.phase };
	}

	validate(token: string): ReviewGateControlResult {
		const active = this.active;
		if (!active || active.token !== token) return { ok: false, error: "Invalid review-gate suspension" };
		if (active.phase !== "restore-only" && (active.expired || this.now() >= active.expiresAt)) {
			return { ok: false, error: "Review-gate suspension expired" };
		}
		return { ok: true, enabled: false, phase: active.phase, expiresAt: active.expiresAt };
	}

	restore(token: string, boundaryCrossed: boolean): ReviewGateControlResult {
		const active = this.active;
		if (!active || active.token !== token) return { ok: false, error: "Invalid review-gate restoration token" };
		if (boundaryCrossed) return { ok: false, error: "Cannot restore review gate after the session boundary" };
		if (active.phase === "publishing") return { ok: false, error: "Publication must settle before review-gate restoration" };
		const enabled = active.wasEnabled;
		this.restoreState(active);
		return { ok: true, enabled };
	}

	shutdown(): void {
		const active = this.active;
		if (!active) return;
		this.clearTimers(active);
		this.active = undefined;
	}

	private expire(token: string): void {
		const active = this.active;
		if (!active || active.token !== token) return;
		active.expired = true;
		if (active.phase === "publishing") {
			active.publicationController?.abort(new Error("Review-gate suspension expired"));
			return;
		}
		if (active.phase === "acquired") this.restoreState(active);
	}

	private match(token: string, phase: SuspensionPhase): ActiveSuspension | undefined {
		const active = this.active;
		return active?.token === token && active.phase === phase ? active : undefined;
	}

	private restoreState(active: ActiveSuspension): void {
		this.clearTimers(active);
		this.active = undefined;
		this.restoreEnabled(active.wasEnabled);
	}

	private clearPublication(active: ActiveSuspension): void {
		if (active.publicationTimer) clearTimeout(active.publicationTimer);
		active.publicationTimer = undefined;
		active.publicationController = undefined;
	}

	private clearTimers(active: ActiveSuspension): void {
		if (active.outerTimer) clearTimeout(active.outerTimer);
		this.clearPublication(active);
		active.outerTimer = undefined;
	}
}

export function controlFailure(message: string): ReviewGateControlResult {
	return { ok: false, error: message };
}

export function suspendFailure(message: string): ReviewGateSuspendResult {
	return { ok: false, error: message };
}

export function publicationFailure(message: string): ReviewGatePublicationResult {
	return { ok: false, error: message };
}
