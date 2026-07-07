/**
 * Generic session-header context. Decouples header state from UI: the variant
 * components below consume only `useSessionHeader()` and never import app stores.
 * Fixtures and the store adapter both flow through the same interface.
 */

import type { RunStatus } from "@plot/registry/record";
import { createRequiredContext } from "../../lib/required-context.js";

export interface SessionHeaderState {
	readonly place: string;
	readonly title: string;
	readonly status: RunStatus;
	readonly startedAtMs: number | undefined;
	readonly lastEventAtMs: number | undefined;
	readonly nowMs: number;
	readonly throughputGraph: string;
	readonly throughputRate: number;
	readonly stderrTail: string | undefined;
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
