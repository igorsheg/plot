import { randomUUID } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
	emptyProjection,
	rebuildProjectionFromSessionHistory,
	type DashboardProjection,
	type RuntimeIdentityProjection,
} from "@plot/control/projection";
import {
	safeParseSessionHistoryEvent,
	type SessionHistoryEvent,
	type SessionHistorySequence,
} from "@plot/control/session-history";
import { TaggedError } from "better-result";

export interface SessionHistoryDiagnostic {
	readonly level: "warning";
	readonly phase: "read" | "parse";
	readonly message: string;
	readonly path: string;
	readonly lineNumber?: number;
}

export class PlotSessionHistoryError extends TaggedError(
	"PlotSessionHistoryError",
)<{
	readonly phase: "read" | "parse" | "write";
	readonly message: string;
	readonly path: string;
	readonly lineNumber?: number;
}>() {}

export interface SessionHistoryFrontier {
	readonly sessionId: string;
	readonly epoch: string;
	readonly lastSequence: number;
	readonly path: string;
}

export interface SessionHistoryReadResult {
	readonly events: readonly SessionHistoryEvent[];
	readonly diagnostics: readonly SessionHistoryDiagnostic[];
	readonly frontier: SessionHistoryFrontier;
}

export interface SessionHistoryAppendInput {
	readonly type: string;
	readonly payload?: unknown;
	readonly timestamp?: string;
}

export interface SessionHistoryStoreOptions {
	readonly sessionDir: string;
	readonly sessionId: string;
	readonly epoch?: string;
}

export interface RebuildDashboardProjectionOptions {
	readonly workflowName: string;
	readonly runtime?: RuntimeIdentityProjection;
}

export interface RecoverInterruptedRunsOptions extends RebuildDashboardProjectionOptions {
	readonly error?: string;
	readonly timestamp?: string;
}

export interface SessionHistoryStore {
	readonly sessionId: string;
	readonly epoch: string;
	readonly sessionPath: string;
	readonly historyPath: string;
	readonly append: (
		event: SessionHistoryAppendInput,
	) => Promise<SessionHistoryEvent>;
	readonly frontier: () => Promise<SessionHistoryFrontier>;
	readonly readAll: () => Promise<SessionHistoryReadResult>;
	readonly replayAfter: (
		afterSequence: number,
	) => Promise<SessionHistoryReadResult>;
	readonly rebuildDashboardProjection: (
		options: RebuildDashboardProjectionOptions,
	) => Promise<{
		readonly projection: DashboardProjection;
		readonly diagnostics: readonly SessionHistoryDiagnostic[];
	}>;
	readonly recoverInterruptedRunsFromPreviousEpoch: (
		options: RecoverInterruptedRunsOptions,
	) => Promise<readonly SessionHistoryEvent[]>;
}

export const createSessionHistoryEpoch = (): string => `epoch-${randomUUID()}`;

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const isNoEntryError = (error: unknown) =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as { readonly code?: unknown }).code === "ENOENT";

const incompleteTailDiagnostic = (
	path: string,
	lineNumber: number,
	error: unknown,
): SessionHistoryDiagnostic => ({
	level: "warning",
	phase: "parse",
	path,
	lineNumber,
	message: `ignored corrupt final Session History line: ${errorMessage(error)}`,
});

const readHistoryFile = async (path: string) => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isNoEntryError(error)) return "";
		throw new PlotSessionHistoryError({
			phase: "read",
			path,
			message: errorMessage(error),
		});
	}
};

const parseHistoryText = (
	path: string,
	text: string,
): Pick<SessionHistoryReadResult, "events" | "diagnostics"> => {
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	const events: SessionHistoryEvent[] = [];
	const diagnostics: SessionHistoryDiagnostic[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (line === undefined || line.trim() === "") continue;
		const lineNumber = index + 1;
		const isFinalLine = index === lines.length - 1;
		try {
			const parsedJson = JSON.parse(line) as unknown;
			const parsedEvent = safeParseSessionHistoryEvent(parsedJson);
			if (!parsedEvent.success) throw parsedEvent.error;
			events.push(parsedEvent.data as SessionHistoryEvent);
		} catch (error) {
			if (isFinalLine) {
				diagnostics.push(incompleteTailDiagnostic(path, lineNumber, error));
				continue;
			}
			throw new PlotSessionHistoryError({
				phase: "parse",
				path,
				lineNumber,
				message: errorMessage(error),
			});
		}
	}
	return { events, diagnostics };
};

const lastSequenceOf = (events: readonly SessionHistoryEvent[]) =>
	Number(events.at(-1)?.sequence ?? 0);

const jsonHistoryReplacer = (_key: string, value: unknown) =>
	value instanceof Map ? [...value] : value;

const readFromDisk = async (
	path: string,
	sessionId: string,
	epoch: string,
): Promise<SessionHistoryReadResult> => {
	const parsed = parseHistoryText(path, await readHistoryFile(path));
	return {
		...parsed,
		frontier: {
			sessionId,
			epoch,
			lastSequence: lastSequenceOf(parsed.events),
			path,
		},
	};
};

export const createSessionHistoryStore = async (
	options: SessionHistoryStoreOptions,
): Promise<SessionHistoryStore> => {
	const epoch = options.epoch ?? createSessionHistoryEpoch();
	const sessionPath = join(options.sessionDir, options.sessionId);
	const historyPath = join(sessionPath, "history.jsonl");
	let cachedLastSequence = lastSequenceOf(
		(await readFromDisk(historyPath, options.sessionId, epoch)).events,
	);
	let appendChain = Promise.resolve();

	const frontier = async (): Promise<SessionHistoryFrontier> => ({
		sessionId: options.sessionId,
		epoch,
		lastSequence: cachedLastSequence,
		path: historyPath,
	});

	const appendUnsafe = async (
		input: SessionHistoryAppendInput,
	): Promise<SessionHistoryEvent> => {
		const sequence = (cachedLastSequence + 1) as SessionHistorySequence;
		const event = {
			sessionId: options.sessionId,
			epoch,
			sequence,
			timestamp: input.timestamp ?? new Date().toISOString(),
			type: input.type,
			payload: input.payload ?? {},
		};
		const parsed = safeParseSessionHistoryEvent(event);
		if (!parsed.success)
			throw new PlotSessionHistoryError({
				phase: "write",
				path: historyPath,
				message: errorMessage(parsed.error),
			});
		try {
			await mkdir(sessionPath, { recursive: true });
			await appendFile(
				historyPath,
				`${JSON.stringify(parsed.data, jsonHistoryReplacer)}\n`,
				"utf8",
			);
			cachedLastSequence = Number(parsed.data.sequence);
			return parsed.data as SessionHistoryEvent;
		} catch (error) {
			throw new PlotSessionHistoryError({
				phase: "write",
				path: historyPath,
				message: errorMessage(error),
			});
		}
	};

	const store: SessionHistoryStore = {
		sessionId: options.sessionId,
		epoch,
		sessionPath,
		historyPath,
		append: (input) => {
			const appended = appendChain.then(() => appendUnsafe(input));
			appendChain = appended.then(
				() => undefined,
				() => undefined,
			);
			return appended;
		},
		frontier,
		readAll: async () => readFromDisk(historyPath, options.sessionId, epoch),
		replayAfter: async (afterSequence) => {
			const result = await readFromDisk(historyPath, options.sessionId, epoch);
			return {
				...result,
				events: result.events.filter(
					(event) => Number(event.sequence) > afterSequence,
				),
			};
		},
		rebuildDashboardProjection: async (rebuildOptions) => {
			const result = await store.readAll();
			const projection = rebuildProjectionFromSessionHistory(
				result.events,
				emptyProjection(
					options.sessionId,
					rebuildOptions.workflowName,
					rebuildOptions.runtime,
				),
			);
			return { projection, diagnostics: result.diagnostics };
		},
		recoverInterruptedRunsFromPreviousEpoch: async (recoverOptions) => {
			const rebuilt = await store.rebuildDashboardProjection(recoverOptions);
			const timestamp = recoverOptions.timestamp ?? new Date().toISOString();
			const error =
				recoverOptions.error ??
				"agent run interrupted by previous Session History epoch recovery";
			const appended: SessionHistoryEvent[] = [];
			for (const run of rebuilt.projection.attempts.values()) {
				appended.push(
					await store.append({
						type: "attempt_completed",
						timestamp,
						payload: {
							completion: {
								runId: run.runId,
								sourceId: run.sourceId,
								workKey: run.workKey,
								status: "interrupted",
								...(run.subject === undefined ? {} : { subject: run.subject }),
								error,
							},
						},
					}),
				);
			}
			return appended;
		},
	};
	return store;
};
