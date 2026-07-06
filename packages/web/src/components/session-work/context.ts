/**
 * Generic session-work context. Decouples the river's state from the app: the
 * item components consume only `useSessionWork()` and never import app stores.
 * Fixtures and the store adapter both flow through this one interface.
 */

import type { OperatorObservationInput } from "@plot/session/runtime";
import { createRequiredContext } from "../../lib/required-context.js";
import type { AttentionItem, MotionItem, SettledItem } from "./view-model.js";

export interface SessionWorkState {
	readonly nowMs: number;
	readonly attention: readonly AttentionItem[];
	readonly motion: readonly MotionItem[];
	readonly settled: readonly SettledItem[];
	readonly denseDecisions: boolean;
	readonly loaded: boolean;
}

export interface SessionWorkActions {
	readonly act: (input: Omit<OperatorObservationInput, "actor">) => void;
	readonly acting: boolean;
}

export interface SessionWorkContextValue {
	readonly state: SessionWorkState;
	readonly actions: SessionWorkActions;
}

export const [SessionWorkProvider, useSessionWork] =
	createRequiredContext<SessionWorkContextValue>(
		"Session work components must be rendered inside <SessionWorkProvider>.",
	);
