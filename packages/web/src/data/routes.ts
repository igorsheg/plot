import type { SessionSummary } from "@plot/session-manager/session";

export const sessionsUrl = "/api/sessions";

export const sessionProjectionUrl = (session: SessionSummary): string =>
	`/api/sessions/${encodeURIComponent(session.id)}/projection`;

export const sessionEventsUrl = (session: SessionSummary, after = 0): string =>
	`/api/sessions/${encodeURIComponent(session.id)}/events?after=${after}`;

export const sessionTranscriptUrl = (input: {
	readonly sessionId: string;
	readonly attemptRunId: string;
}): string =>
	`/api/sessions/${encodeURIComponent(input.sessionId)}/attempts/${encodeURIComponent(input.attemptRunId)}/transcript`;
