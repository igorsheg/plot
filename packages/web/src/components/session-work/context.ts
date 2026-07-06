/**
 * Generic session-work context. Decouples the river's state from the app: the
 * item components consume only `useSessionWork()` and never import app stores.
 * Fixtures and the store adapter both flow through this one interface.
 */

import type { OperatorObservationInput } from "@plot/session/runtime";
import { createContext, createElement, type ReactNode, use } from "react";
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

const SessionWorkContext = createContext<SessionWorkContextValue | null>(null);

export interface SessionWorkProviderProps {
	readonly value: SessionWorkContextValue;
	readonly children: ReactNode;
}

export function SessionWorkProvider({
	value,
	children,
}: SessionWorkProviderProps) {
	return createElement(SessionWorkContext, { value }, children);
}

export function useSessionWork(): SessionWorkContextValue {
	const context = use(SessionWorkContext);
	if (context === null) {
		throw new Error(
			"Session work components must be rendered inside <SessionWorkProvider>.",
		);
	}
	return context;
}
