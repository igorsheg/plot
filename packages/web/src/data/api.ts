import {
	parseSerializedDashboardProjection,
	type SerializedDashboardProjection,
} from "@plot/projection";
import type { SessionSummary } from "@plot/session-manager/session";
import type {
	OperatorObservationInput,
	SourceActionInput,
	SourceActionStartResult,
} from "@plot/session/runtime";
import type { TranscriptEntry } from "@plot/session/transcript";
import { asRecord, asString } from "./parse.js";
import { parseSessions } from "./session.js";

const httpError = (response: Response): Error =>
	new Error(`HTTP ${response.status}`);

const fetchOk = async (url: string, init?: RequestInit): Promise<Response> => {
	const response = await fetch(url, init);
	if (!response.ok) throw httpError(response);
	return response;
};

const fetchJson = async (url: string, init?: RequestInit): Promise<unknown> =>
	(await fetchOk(url, init)).json();

export const fetchSessions = async (): Promise<readonly SessionSummary[]> =>
	parseSessions(await fetchJson("/api/sessions"));

export const recordObservation = async (
	sessionId: string,
	input: Omit<OperatorObservationInput, "actor">,
): Promise<boolean> => {
	const data = asRecord(
		await fetchJson(
			`/api/sessions/${encodeURIComponent(sessionId)}/observations`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input),
			},
		),
	);
	return data?.["accepted"] === true;
};

export const startSourceAction = async (
	sessionId: string,
	input: SourceActionInput,
): Promise<SourceActionStartResult> => {
	const data = asRecord(
		await fetchJson(
			`/api/sessions/${encodeURIComponent(sessionId)}/source-actions`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input),
			},
		),
	);
	if (data?.["accepted"] !== true) return { accepted: false };
	const actionRunId = asString(data["actionRunId"]);
	return actionRunId === undefined
		? { accepted: false }
		: { accepted: true, actionRunId };
};

export const cancelSourceAction = async (
	sessionId: string,
	actionRunId: string,
): Promise<boolean> => {
	const data = asRecord(
		await fetchJson(
			`/api/sessions/${encodeURIComponent(sessionId)}/source-actions/${encodeURIComponent(actionRunId)}`,
			{ method: "DELETE" },
		),
	);
	return data?.["accepted"] === true;
};

export const stopSession = async (id: string): Promise<void> => {
	await fetchOk(`/api/sessions/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
};

export const fetchSessionProjectionUrl = async (
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
	sessionId: string,
	attemptRunId: string,
): Promise<TranscriptResult> => {
	const response = await fetch(
		`/api/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(
			attemptRunId,
		)}/transcript`,
	);
	if (response.status === 404) return { entries: [], notRecorded: true };
	if (!response.ok) throw httpError(response);
	return parseTranscript(await response.json());
};
