import type {
	ActivityEntry,
	CompletedWorkProjection,
	RuntimeIdentityProjection,
	ScheduledWakeProjection,
	SerializedAgentAttemptProjection,
	SerializedDashboardProjection,
	TokenSample,
	WorkItemProjection,
} from "@plot/projection";
import type { RunRecord } from "@plot/registry/record";
import type { OperatorObservationInput } from "@plot/session/runtime";
import type { TranscriptEntry } from "@plot/session/transcript";
import { asNumber, asRecord, asString, asStringArray } from "./parse.js";
import { parsePlotRuns } from "./run.js";

const projectionStatuses = new Set([
	"starting",
	"idle",
	"running",
	"shutting_down",
	"paused",
	"stopped",
	"error",
]);

const emptyRuntime: RuntimeIdentityProjection = {
	cwd: "",
	cwdName: "",
	skills: [],
	skillPaths: [],
};

const parseRuntime = (value: unknown): RuntimeIdentityProjection => {
	const record = asRecord(value);
	const cwd = asString(record?.["cwd"]);
	const cwdName = asString(record?.["cwdName"]);
	if (record === undefined || cwd === undefined || cwdName === undefined) {
		return emptyRuntime;
	}
	return {
		cwd,
		cwdName,
		skills: asStringArray(record["skills"]) ?? [],
		skillPaths: asStringArray(record["skillPaths"]) ?? [],
		workflowPath: asString(record["workflowPath"]),
		provider: asString(record["provider"]),
		model: asString(record["model"]),
		thinking: asString(record["thinking"]),
		tickIntervalMs: asNumber(record["tickIntervalMs"]),
		maxConcurrentRuns: asNumber(record["maxConcurrentRuns"]),
		maxRunDurationMs: asNumber(record["maxRunDurationMs"]),
	};
};

const parseActivity = (value: unknown): readonly ActivityEntry[] =>
	Array.isArray(value)
		? value.flatMap((entry) => {
				const record = asRecord(entry);
				const atMs = asNumber(record?.["atMs"]);
				const tone = asString(record?.["tone"]);
				const text = asString(record?.["text"]);
				return record !== undefined &&
					atMs !== undefined &&
					(tone === "ok" || tone === "bad" || tone === "info") &&
					text !== undefined
					? [{ atMs, tone, text }]
					: [];
			})
		: [];

export const parseProjection = (
	value: unknown,
): SerializedDashboardProjection | undefined => {
	const envelope = asRecord(value);
	const record = asRecord(envelope?.["projection"] ?? value);
	const sessionId = asString(record?.["sessionId"]);
	const workflowName = asString(record?.["workflowName"]);
	const status = asString(record?.["status"]);
	const frontier = asNumber(record?.["frontier"]);
	if (
		record === undefined ||
		sessionId === undefined ||
		workflowName === undefined ||
		status === undefined ||
		!projectionStatuses.has(status) ||
		frontier === undefined
	) {
		return undefined;
	}
	const usage = asRecord(record["usageTotals"]);
	return {
		sessionId,
		workflowName,
		status: status as SerializedDashboardProjection["status"],
		frontier,
		runtime: parseRuntime(record["runtime"]),
		usageTotals: {
			tokens: asNumber(usage?.["tokens"]) ?? 0,
			cost: asNumber(usage?.["cost"]),
		},
		tokenSamples: (Array.isArray(record["tokenSamples"])
			? record["tokenSamples"]
			: []) as readonly TokenSample[],
		work: (asRecord(record["work"]) ?? {}) as Record<
			string,
			WorkItemProjection
		>,
		attempts: (asRecord(record["attempts"]) ?? {}) as Record<
			string,
			SerializedAgentAttemptProjection
		>,
		completed: (Array.isArray(record["completed"])
			? record["completed"]
			: []) as readonly CompletedWorkProjection[],
		diagnostics: asStringArray(record["diagnostics"]) ?? [],
		scheduledWakes: (Array.isArray(record["scheduledWakes"])
			? record["scheduledWakes"]
			: []) as readonly ScheduledWakeProjection[],
		activity: parseActivity(record["activity"]),
		debugEvents: asStringArray(record["debugEvents"]) ?? [],
	};
};

const httpError = (response: Response): Error =>
	new Error(`HTTP ${response.status}`);

const fetchOk = async (url: string, init?: RequestInit): Promise<Response> => {
	const response = await fetch(url, init);
	if (!response.ok) throw httpError(response);
	return response;
};

const fetchJson = async (url: string, init?: RequestInit): Promise<unknown> =>
	(await fetchOk(url, init)).json();

export const fetchRuns = async (): Promise<readonly RunRecord[]> =>
	parsePlotRuns(await fetchJson("/api/runs"));

export const recordObservation = async (
	runId: string,
	input: Omit<OperatorObservationInput, "actor">,
): Promise<boolean> => {
	const data = asRecord(
		await fetchJson(`/api/runs/${encodeURIComponent(runId)}/observations`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		}),
	);
	return data?.["accepted"] === true;
};

export const stopRun = async (id: string): Promise<void> => {
	await fetchOk(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
};

export const fetchRunProjectionUrl = async (
	url: string,
): Promise<SerializedDashboardProjection> => {
	const projection = parseProjection(await fetchJson(url));
	if (projection === undefined) throw new Error("invalid projection response");
	return projection;
};

/**
 * A transcript read result. `notRecorded` distinguishes a deliberate 404 ("no
 * transcript recorded" — a normal state) from a transport error (which throws).
 */
export interface TranscriptResult {
	readonly entries: readonly TranscriptEntry[];
	readonly notRecorded: boolean;
}

const transcriptRoles = new Set(["user", "assistant", "tool"]);
const transcriptKinds = new Set([
	"text",
	"thinking",
	"tool-call",
	"tool-result",
]);

const parseTranscriptEntry = (value: unknown): readonly TranscriptEntry[] => {
	const record = asRecord(value);
	const role = asString(record?.["role"]);
	const kind = asString(record?.["kind"]);
	const text = asString(record?.["text"]);
	if (
		record === undefined ||
		role === undefined ||
		!transcriptRoles.has(role) ||
		kind === undefined ||
		!transcriptKinds.has(kind) ||
		text === undefined
	) {
		return [];
	}
	const entry: TranscriptEntry = {
		role: role as TranscriptEntry["role"],
		kind: kind as TranscriptEntry["kind"],
		text,
		at: asString(record["at"]),
		name: asString(record["name"]),
	};
	return [entry];
};

/** Defensive parse of the gateway `{ entries }` envelope; junk blocks skipped. */
export const parseTranscript = (value: unknown): TranscriptResult => {
	const record = asRecord(value);
	const raw = record?.["entries"];
	const entries = Array.isArray(raw) ? raw.flatMap(parseTranscriptEntry) : [];
	return { entries, notRecorded: false };
};

/**
 * Read one attempt's transcript tail from the gateway. A 404 is not an error —
 * it means no transcript was recorded, surfaced as an empty flagged result.
 */
export const fetchAttemptTranscript = async (
	runId: string,
	attemptRunId: string,
): Promise<TranscriptResult> => {
	const response = await fetch(
		`/api/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(
			attemptRunId,
		)}/transcript`,
	);
	if (response.status === 404) return { entries: [], notRecorded: true };
	if (!response.ok) throw httpError(response);
	return parseTranscript(await response.json());
};
