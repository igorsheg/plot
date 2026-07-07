/**
 * Generic session-dock context. Decouples the dock's state from the app: the
 * dock components consume only `useSessionDock()` and never import app stores.
 * Fixtures and the store adapter both flow through this one interface.
 */

import { createRequiredContext } from "../../lib/required-context.js";
import type { DockLineItem } from "./view-model.js";

export interface SessionDockState {
	readonly live: readonly DockLineItem[];
	readonly past: readonly DockLineItem[];
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

export const [SessionDockProvider, useSessionDock] =
	createRequiredContext<SessionDockContextValue>(
		"Session dock components must be rendered inside <SessionDockProvider>.",
	);
