import { isRecord } from "@plot/common/primitives";

export type SessionState =
	| "starting"
	| "online"
	| "stopping"
	| "stopped"
	| "error";

export interface SessionSummary {
	readonly id: string;
	readonly workflowKey: string;
	readonly workflowName: string;
	readonly workflowPath: string;
	readonly projectPath: string;
	readonly state: SessionState;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly historyPath: string;
	readonly lastSequence: number;
	readonly diagnostic?: string;
}

export const isActiveSession = (session: SessionSummary): boolean =>
	session.state === "starting" ||
	session.state === "online" ||
	session.state === "stopping";

const states = new Set<SessionState>([
	"starting",
	"online",
	"stopping",
	"stopped",
	"error",
]);

const text = (value: unknown, label: string): string => {
	if (typeof value === "string" && value.length > 0) return value;
	throw new Error(`${label} must be a non-empty string`);
};

export const parseSessionSummary = (value: unknown): SessionSummary => {
	if (!isRecord(value)) throw new Error("Session summary must be an object");
	const state = text(value["state"], "Session state");
	if (!states.has(state as SessionState))
		throw new Error(`unknown Session state: ${state}`);
	const lastSequence = value["lastSequence"];
	if (
		typeof lastSequence !== "number" ||
		!Number.isInteger(lastSequence) ||
		lastSequence < 0
	)
		throw new Error("Session lastSequence must be a non-negative integer");
	const summary: SessionSummary = {
		id: text(value["id"], "Session id"),
		workflowKey: text(value["workflowKey"], "Workflow key"),
		workflowName: text(value["workflowName"], "Workflow name"),
		workflowPath: text(value["workflowPath"], "Workflow path"),
		projectPath: text(value["projectPath"], "project path"),
		state: state as SessionState,
		createdAt: text(value["createdAt"], "Session createdAt"),
		updatedAt: text(value["updatedAt"], "Session updatedAt"),
		historyPath: text(value["historyPath"], "Session historyPath"),
		lastSequence,
	};
	if (typeof value["diagnostic"] === "string")
		return { ...summary, diagnostic: value["diagnostic"] };
	return summary;
};

export const parseSessionSummaries = (
	value: unknown,
): readonly SessionSummary[] => {
	if (!Array.isArray(value))
		throw new Error("Session store must contain an array");
	return value.map(parseSessionSummary);
};
