/**
 * Generic session-dock context. Decouples the dock's state from the app: the
 * dock components consume only `useSessionDock()` and never import app stores.
 * Fixtures and the store adapter both flow through this one interface.
 */

import { createContext, createElement, type ReactNode, use } from "react";
import type { DockTile } from "./view-model.js";

export interface SessionDockState {
	readonly live: readonly DockTile[];
	readonly past: readonly DockTile[];
	readonly expanded: boolean;
	readonly nowMs: number;
}

export interface SessionDockActions {
	readonly select: (id: string) => void;
	readonly toggleExpanded: () => void;
}

export interface SessionDockContextValue {
	readonly state: SessionDockState;
	readonly actions: SessionDockActions;
}

const SessionDockContext = createContext<SessionDockContextValue | null>(null);

export interface SessionDockProviderProps {
	readonly value: SessionDockContextValue;
	readonly children: ReactNode;
}

export function SessionDockProvider({
	value,
	children,
}: SessionDockProviderProps) {
	return createElement(SessionDockContext, { value }, children);
}

export function useSessionDock(): SessionDockContextValue {
	const context = use(SessionDockContext);
	if (context === null) {
		throw new Error(
			"Session dock components must be rendered inside <SessionDockProvider>.",
		);
	}
	return context;
}
