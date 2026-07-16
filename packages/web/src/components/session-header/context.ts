/**
 * Generic session-header context. Decouples header state from UI: the variant
 * components below consume only `useSessionHeader()` and never import app stores.
 * Fixtures and the store adapter both flow through the same interface.
 */

import type { RuntimeIdentityProjection, UsageTotals } from "@plot/projection";
import type { SessionState } from "@plot/session-manager/session";
import { createRequiredContext } from "../../lib/required-context.js";

/** Cumulative usage for the Session — the ledger's tally. */
export type SessionUsage = Required<UsageTotals>;

/** Static Session configuration, disclosed from the kicker popover. */
export type SessionConfig = Required<
	Pick<
		RuntimeIdentityProjection,
		| "model"
		| "provider"
		| "workflowPath"
		| "tickIntervalMs"
		| "maxConcurrentRuns"
		| "maxRunDurationMs"
	>
> &
	Pick<RuntimeIdentityProjection, "cwd" | "skills"> & {
		readonly workflow: string;
	};

export interface SessionHeaderState {
	readonly place: string;
	readonly title: string;
	readonly status: SessionState;
	readonly startedAtMs: number | undefined;
	readonly lastEventAtMs: number | undefined;
	readonly nowMs: number;
	readonly throughputGraph: string;
	readonly throughputRate: number;
	readonly stderrTail: string | undefined;
	readonly usage: SessionUsage;
	readonly config: SessionConfig;
}

export interface SessionHeaderActions {
	readonly stop: () => void;
	readonly stopping: boolean;
}

export interface SessionHeaderContextValue {
	readonly state: SessionHeaderState;
	readonly actions: SessionHeaderActions;
}

export const [SessionHeaderProvider, useSessionHeader] =
	createRequiredContext<SessionHeaderContextValue>(
		"Session header components must be rendered inside <SessionHeaderProvider>.",
	);
