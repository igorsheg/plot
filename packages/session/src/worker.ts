import {
	parseBoundaryErrorRecord,
	PlotBoundaryError,
	toBoundaryErrorRecord,
	type BoundaryErrorRecord,
} from "@plot/common/boundary-error";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { isRecord } from "@plot/common/primitives";
import {
	createSessionHost,
	type CreateSessionHostOptions,
	type SessionHost,
} from "./host.js";
import type {
	InterruptAgentRunInput,
	OperatorObservationInput,
	RuntimeEvent,
	SourceActionInput,
} from "./runtime.js";

export const workerMaxLineBytes = 2 * 1024 * 1024;

export type SessionWorkerAction =
	| "start"
	| "shutdown"
	| "state"
	| "tick"
	| "pause"
	| "resume"
	| "interrupt"
	| "observe"
	| "source-action"
	| "source-action-cancel";

export interface SessionWorkerCommand {
	readonly kind: "command";
	readonly id: string;
	readonly action: SessionWorkerAction;
	readonly input?: unknown;
}

export interface SessionWorkerReady {
	readonly kind: "ready";
	readonly sessionId: string;
	readonly workflowName: string;
	readonly workflowPath: string;
	readonly projectPath: string;
	readonly historyPath: string;
}

export interface SessionWorkerEvent {
	readonly kind: "event";
	readonly event: RuntimeEvent;
}

export interface SessionWorkerFailure {
	readonly kind: "failure";
	readonly error: BoundaryErrorRecord;
}

export type SessionWorkerResult =
	| {
			readonly kind: "result";
			readonly id: string;
			readonly ok: true;
			readonly value?: unknown;
	  }
	| {
			readonly kind: "result";
			readonly id: string;
			readonly ok: false;
			readonly error: BoundaryErrorRecord;
	  };

export type SessionWorkerRecord =
	| SessionWorkerReady
	| SessionWorkerEvent
	| SessionWorkerFailure
	| SessionWorkerResult;

export class SessionWorkerProtocolError extends PlotBoundaryError {
	override readonly name = "SessionWorkerProtocolError";

	constructor(message: string, phase: "command" | "record") {
		super({
			code: "worker_protocol_error",
			message,
			retryable: false,
			context: { phase },
		});
	}
}

const invalidCommand = (message: string): never => {
	throw new SessionWorkerProtocolError(message, "command");
};

const invalidRecord = (message: string): never => {
	throw new SessionWorkerProtocolError(message, "record");
};

const nonEmptyString = (
	value: unknown,
	label: string,
	invalid: (message: string) => never,
): string =>
	typeof value === "string" && value.length > 0
		? value
		: invalid(`${label} must be a non-empty string`);

const actions = new Set<SessionWorkerAction>([
	"start",
	"shutdown",
	"state",
	"tick",
	"pause",
	"resume",
	"interrupt",
	"observe",
	"source-action",
	"source-action-cancel",
]);

export const decodeSessionWorkerCommand = (
	value: unknown,
): SessionWorkerCommand => {
	if (!isRecord(value) || value["kind"] !== "command")
		return invalidCommand("invalid Session worker command");
	const action = nonEmptyString(
		value["action"],
		"worker action",
		invalidCommand,
	);
	if (!actions.has(action as SessionWorkerAction))
		return invalidCommand(`unknown Session worker action: ${action}`);
	return {
		kind: "command",
		id: nonEmptyString(value["id"], "worker command id", invalidCommand),
		action: action as SessionWorkerAction,
		input: value["input"],
	};
};

export const decodeSessionWorkerRecord = (
	value: unknown,
): SessionWorkerRecord => {
	if (!isRecord(value)) return invalidRecord("invalid Session worker record");
	if (value["kind"] === "ready")
		return {
			kind: "ready",
			sessionId: nonEmptyString(value["sessionId"], "sessionId", invalidRecord),
			workflowName: nonEmptyString(
				value["workflowName"],
				"workflowName",
				invalidRecord,
			),
			workflowPath: nonEmptyString(
				value["workflowPath"],
				"workflowPath",
				invalidRecord,
			),
			projectPath: nonEmptyString(
				value["projectPath"],
				"projectPath",
				invalidRecord,
			),
			historyPath: nonEmptyString(
				value["historyPath"],
				"historyPath",
				invalidRecord,
			),
		};
	if (value["kind"] === "event") {
		if (!isRecord(value["event"])) return invalidRecord("invalid worker event");
		return { kind: "event", event: value["event"] as unknown as RuntimeEvent };
	}
	if (value["kind"] === "failure")
		return {
			kind: "failure",
			error: parseBoundaryErrorRecord(value["error"]),
		};
	if (value["kind"] !== "result")
		return invalidRecord("unknown Session worker record");
	const id = nonEmptyString(value["id"], "worker result id", invalidRecord);
	if (value["ok"] === true)
		return { kind: "result", id, ok: true, value: value["value"] };
	if (value["ok"] === false)
		return {
			kind: "result",
			id,
			ok: false,
			error: parseBoundaryErrorRecord(value["error"]),
		};
	return invalidRecord("worker result ok must be boolean");
};

export const encodeSessionWorkerRecord = (
	record: SessionWorkerRecord | SessionWorkerCommand,
): string => stringifyJsonl(record, { maxLineBytes: workerMaxLineBytes });

const objectInput = <A>(value: unknown, label: string): A =>
	isRecord(value)
		? (value as A)
		: invalidCommand(`${label} input must be an object`);

const handleCommand = async (
	host: SessionHost,
	command: SessionWorkerCommand,
): Promise<unknown> => {
	switch (command.action) {
		case "start":
			await host.runtime.start();
			return host.runtime.state();
		case "shutdown":
			await host.shutdown();
			return true;
		case "state":
			return host.runtime.state();
		case "tick":
			return host.runtime.tickOnce();
		case "pause":
			await host.runtime.pauseDispatch();
			return true;
		case "resume":
			await host.runtime.resumeDispatch();
			return true;
		case "interrupt":
			return host.runtime.interruptAgentRun(
				objectInput<InterruptAgentRunInput>(command.input, command.action),
			);
		case "observe":
			return host.runtime.recordOperatorObservation(
				objectInput<OperatorObservationInput>(command.input, command.action),
			);
		case "source-action":
			return host.runtime.startSourceAction(
				objectInput<SourceActionInput>(command.input, command.action),
			);
		case "source-action-cancel":
			return host.runtime.cancelSourceAction(
				nonEmptyString(command.input, "actionRunId", invalidCommand),
			);
	}
};

export interface ServeSessionWorkerOptions extends CreateSessionHostOptions {
	readonly stdin: AsyncIterable<string | Uint8Array>;
	readonly writeLine: (line: string) => Promise<void> | void;
}

export const serveSessionWorker = async (
	options: ServeSessionWorkerOptions,
): Promise<void> => {
	let writes = Promise.resolve();
	const write = (record: SessionWorkerRecord): Promise<void> => {
		writes = writes.then(() =>
			options.writeLine(encodeSessionWorkerRecord(record)),
		);
		return writes;
	};
	let host: SessionHost;
	try {
		host = await createSessionHost(options);
	} catch (error) {
		await write({
			kind: "failure",
			error: toBoundaryErrorRecord(error, "session-worker-startup"),
		});
		return;
	}
	const state = await host.runtime.state();
	if (state.sessionFile === undefined)
		throw new Error("Session worker requires durable history");
	await write({
		kind: "ready",
		sessionId: host.runtime.id,
		workflowName: host.metadata.workflowName,
		workflowPath: host.metadata.workflowPath,
		projectPath: host.metadata.cwd,
		historyPath: state.sessionFile,
	});
	const controller = new AbortController();
	const eventPump = (async () => {
		for await (const event of host.runtime.events(controller.signal))
			await write({ kind: "event", event });
	})();
	try {
		for await (const line of jsonlLines(options.stdin, {
			maxLineBytes: workerMaxLineBytes,
		})) {
			if (line.trim() === "") continue;
			let command: SessionWorkerCommand;
			try {
				command = decodeSessionWorkerCommand(parseJsonl(line));
			} catch (error) {
				await write({
					kind: "result",
					id: "invalid",
					ok: false,
					error: toBoundaryErrorRecord(error, "session-worker-command"),
				});
				continue;
			}
			try {
				const value = await handleCommand(host, command);
				await write({ kind: "result", id: command.id, ok: true, value });
			} catch (error) {
				await write({
					kind: "result",
					id: command.id,
					ok: false,
					error: toBoundaryErrorRecord(error, "session-worker-runtime"),
				});
			}
			if (command.action === "shutdown") break;
		}
	} finally {
		await host.shutdown().catch(() => undefined);
		controller.abort();
		await eventPump;
		await writes;
	}
};
