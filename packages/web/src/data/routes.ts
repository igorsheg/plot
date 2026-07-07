import type { RunRecord } from "@plot/registry/record";

export const runsUrl = "/api/runs";

export const runProjectionUrl = (run: RunRecord): string =>
	`/api/runs/${encodeURIComponent(run.id)}/projection`;

export const runEventsUrl = (
	run: RunRecord,
	after = run.lastSequence ?? 0,
): string => `/api/runs/${encodeURIComponent(run.id)}/events?after=${after}`;

export const runTranscriptUrl = (input: {
	readonly runId: string;
	readonly attemptRunId: string;
}): string =>
	`/api/runs/${encodeURIComponent(input.runId)}/attempts/${encodeURIComponent(
		input.attemptRunId,
	)}/transcript`;
