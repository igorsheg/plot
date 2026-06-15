import type { OperatorAction } from "@plot/control/operator";
import type { PlotCommand } from "@plot/control/protocol";
import { createContext, type ReactNode, use, useMemo } from "react";

import type { PlotWebDashboardState } from "./web-dashboard-state";

// Composition-patterns: state is lifted into a provider and split into three
// clear slices — state (the live frame), actions (intent), and meta (control
// posture) — so screens and rows read exactly the slice they need via a hook
// instead of receiving deep prop chains. Domain/transport logic stays in
// @plot/control + web-dashboard-state; this layer only shapes and routes it.

export interface DashboardStateSlice {
	readonly connection: PlotWebDashboardState["connection"];
	readonly roster: PlotWebDashboardState["roster"];
	readonly selectedSessionId?: string | undefined;
	readonly projection?: PlotWebDashboardState["projection"];
	readonly lastError?: string | undefined;
	readonly mutationError?: string | undefined;
	readonly snapshotUnavailable?: boolean | undefined;
}

export interface OperatorActionInput {
	readonly sessionId: string;
	readonly workKey: string;
	readonly actionId: string;
	readonly comment?: string | undefined;
}

export interface DashboardActions {
	/** Pause/resume/reconcile/close a session. No-op for observers. */
	readonly mutateSession: (sessionId: string, command: PlotCommand) => void;
	/** Run an operator action on a work item. Rejects if the send fails. */
	readonly performOperatorAction: (input: OperatorActionInput) => Promise<void>;
	/** Interrupt a running agent run. */
	readonly interruptRun: (input: {
		sessionId: string;
		runId: string;
		workKey: string;
	}) => void;
}

export interface DashboardMeta {
	readonly controlRole: "observer" | "controller";
	readonly isController: boolean;
	/** A reason string when an action is blocked by control posture, else undefined. */
	readonly controllerBlockReason?: string | undefined;
}

interface DashboardContextValue {
	readonly state: DashboardStateSlice;
	readonly actions: DashboardActions;
	readonly meta: DashboardMeta;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

function useDashboard(): DashboardContextValue {
	const ctx = use(DashboardContext);
	if (!ctx) {
		throw new Error("useDashboard must be used within a DashboardProvider");
	}
	return ctx;
}

export function useDashboardState(): DashboardStateSlice {
	return useDashboard().state;
}

export function useDashboardActions(): DashboardActions {
	return useDashboard().actions;
}

export function useDashboardMeta(): DashboardMeta {
	return useDashboard().meta;
}

/** Tone helper for an operator action, shared by every action surface. */
export function operatorActionTone(
	action: OperatorAction,
): "primary" | "tertiary" {
	return action.tone === "primary" ? "primary" : "tertiary";
}

export function DashboardProvider({
	state,
	children,
}: {
	state: PlotWebDashboardState;
	children: ReactNode;
}) {
	const isController = state.controlRole === "controller";
	const controllerBlockReason = isController
		? undefined
		: "controller required";
	const send = state.sendCommand;

	const value = useMemo<DashboardContextValue>(() => {
		const stateSlice: DashboardStateSlice = {
			connection: state.connection,
			roster: state.roster,
			selectedSessionId: state.selectedSessionId,
			projection: state.projection,
			lastError: state.lastError,
			mutationError: state.mutationError,
			snapshotUnavailable: state.snapshotUnavailable,
		};

		const actions: DashboardActions = {
			mutateSession: (sessionId, command) => {
				if (!send || !isController) return;
				void send(command, { sessionId }).catch(() => undefined);
			},
			performOperatorAction: async ({
				sessionId,
				workKey,
				actionId,
				comment,
			}) => {
				if (!send || !isController) return;
				await send("perform_operator_action", {
					sessionId,
					workKey,
					actionId,
					...(comment === undefined ? {} : { comment }),
				});
			},
			interruptRun: ({ sessionId, runId, workKey }) => {
				if (!send || !isController) return;
				void send("interrupt_agent_run", { sessionId, runId, workKey }).catch(
					() => undefined,
				);
			},
		};

		const meta: DashboardMeta = {
			controlRole: state.controlRole,
			isController,
			controllerBlockReason,
		};

		return { state: stateSlice, actions, meta };
	}, [state, send, isController, controllerBlockReason]);

	return (
		<DashboardContext.Provider value={value}>
			{children}
		</DashboardContext.Provider>
	);
}
