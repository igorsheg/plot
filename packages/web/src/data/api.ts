import {
	parseSerializedDashboardProjection,
	type SerializedDashboardProjection,
} from "@plot/projection";
import type { RunRecord } from "@plot/registry/record";
import type {
	OperatorObservationInput,
	SourceActionInput,
	SourceActionStartResult,
} from "@plot/session/runtime";
import type { TranscriptEntry } from "@plot/session/transcript";
import { asRecord, asString } from "./parse.js";
import { parsePlotRuns } from "./run.js";

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

export const startSourceAction = async (
	runId: string,
	input: SourceActionInput,
): Promise<SourceActionStartResult> => {
	const data = asRecord(
		await fetchJson(`/api/runs/${encodeURIComponent(runId)}/source-actions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		}),
	);
	const result: { accepted: boolean; actionRunId?: string } = {
		accepted: data?.["accepted"] === true,
	};
	const actionRunId = asString(data?.["actionRunId"]);
	if (actionRunId !== undefined) result.actionRunId = actionRunId;
	return result;
};

export const cancelSourceAction = async (
	runId: string,
	actionRunId: string,
): Promise<boolean> => {
	const data = asRecord(
		await fetchJson(
			`/api/runs/${encodeURIComponent(runId)}/source-actions/${encodeURIComponent(actionRunId)}`,
			{ method: "DELETE" },
		),
	);
	return data?.["accepted"] === true;
};

export const stopRun = async (id: string): Promise<void> => {
	await fetchOk(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
};

export const fetchRunProjectionUrl = async (
	url: string,
): Promise<SerializedDashboardProjection> => {
	const projection = parseSerializedDashboardProjection(await fetchJson(url));
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
