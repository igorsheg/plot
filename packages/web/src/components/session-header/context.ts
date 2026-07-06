/**
 * Generic session-header context. Decouples header state from UI: the variant
 * components below consume only `useSessionHeader()` and never import app stores.
 * Fixtures and the store adapter both flow through the same interface.
 */

import type { RunStatus } from "@plot/registry/record";
import { createContext, createElement, type ReactNode, use } from "react";
import type { LiveLinePoint } from "../ui/live-line/scale.js";

export interface SessionHeaderState {
	readonly place: string;
	readonly title: string;
	readonly status: RunStatus;
	readonly startedAtMs: number | undefined;
	readonly lastEventAtMs: number | undefined;
	readonly nowMs: number;
	readonly series: readonly LiveLinePoint[];
	readonly rate: number;
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

const SessionHeaderContext = createContext<SessionHeaderContextValue | null>(
	null,
);

interface SessionHeaderProviderProps {
	readonly value: SessionHeaderContextValue;
	readonly children: ReactNode;
}

export function SessionHeaderProvider({
	value,
	children,
}: SessionHeaderProviderProps) {
	return createElement(SessionHeaderContext, { value }, children);
}

export function useSessionHeader(): SessionHeaderContextValue {
	const context = use(SessionHeaderContext);
	if (context === null) {
		throw new Error(
			"Session header components must be rendered inside <SessionHeaderProvider>.",
		);
	}
	return context;
}
