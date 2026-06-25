import {
	parsePlotSessionRegistrations,
	type PlotSessionRegistration,
} from "./registration.js";

export interface PlotEventRecord {
	readonly kind: "event";
	readonly event: {
		readonly sequence: number;
		readonly timestamp: string;
		readonly type: string;
	};
}

export interface WebDashboardProjection {
	readonly sessionId: string;
	readonly workflowName: string;
	readonly status: string;
	readonly frontier: number;
	readonly work: Record<string, unknown>;
	readonly attempts: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

export const parsePlotEventRecord = (
	value: unknown,
): PlotEventRecord | undefined => {
	if (!isRecord(value) || value["kind"] !== "event") return undefined;
	const event = value["event"];
	if (!isRecord(event)) return undefined;
	if (
		typeof event["sequence"] !== "number" ||
		typeof event["timestamp"] !== "string" ||
		typeof event["type"] !== "string"
	)
		return undefined;
	return {
		kind: "event",
		event: {
			sequence: event["sequence"],
			timestamp: event["timestamp"],
			type: event["type"],
		},
	};
};

const parseProjection = (
	value: unknown,
): WebDashboardProjection | undefined => {
	if (!isRecord(value)) return undefined;
	const projection = isRecord(value["projection"])
		? value["projection"]
		: value;
	if (
		typeof projection["sessionId"] !== "string" ||
		typeof projection["workflowName"] !== "string" ||
		typeof projection["status"] !== "string" ||
		typeof projection["frontier"] !== "number"
	)
		return undefined;
	return {
		sessionId: projection["sessionId"],
		workflowName: projection["workflowName"],
		status: projection["status"],
		frontier: projection["frontier"],
		work: isRecord(projection["work"]) ? projection["work"] : {},
		attempts: isRecord(projection["attempts"]) ? projection["attempts"] : {},
	};
};

export const fetchSessions = async (): Promise<
	readonly PlotSessionRegistration[]
> => {
	const response = await fetch("/api/sessions");
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return parsePlotSessionRegistrations(await response.json());
};

export const fetchSessionProjection = async (
	key: string,
): Promise<WebDashboardProjection> => {
	const response = await fetch(
		`/api/sessions/${encodeURIComponent(key)}/projection`,
	);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const projection = parseProjection(await response.json());
	if (projection === undefined) throw new Error("invalid projection response");
	return projection;
};

export const sessionEventsUrl = (key: string, after: number): string =>
	`/api/sessions/${encodeURIComponent(key)}/events?after=${after}`;
