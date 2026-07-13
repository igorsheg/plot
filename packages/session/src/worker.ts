import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { errorMessage, isRecord } from "@plot/common/primitives";
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
			readonly error: string;
	  };

export type SessionWorkerRecord =
	| SessionWorkerReady
	| SessionWorkerEvent
	| SessionWorkerResult;

const invalid = (message: string): never => {
	throw new Error(message);
};

const nonEmptyString = (value: unknown, label: string): string =>
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
		return invalid("invalid Session worker command");
	const action = nonEmptyString(value["action"], "worker action");
	if (!actions.has(action as SessionWorkerAction))
		return invalid(`unknown Session worker action: ${action}`);
	return {
		kind: "command",
		id: nonEmptyString(value["id"], "worker command id"),
		action: action as SessionWorkerAction,
		input: value["input"],
	};
};

export const decodeSessionWorkerRecord = (
	value: unknown,
): SessionWorkerRecord => {
	if (!isRecord(value)) return invalid("invalid Session worker record");
	if (value["kind"] === "ready")
		return {
			kind: "ready",
			sessionId: nonEmptyString(value["sessionId"], "sessionId"),
			workflowName: nonEmptyString(value["workflowName"], "workflowName"),
			workflowPath: nonEmptyString(value["workflowPath"], "workflowPath"),
			projectPath: nonEmptyString(value["projectPath"], "projectPath"),
			historyPath: nonEmptyString(value["historyPath"], "historyPath"),
		};
	if (value["kind"] === "event") {
		if (!isRecord(value["event"])) return invalid("invalid worker event");
		return { kind: "event", event: value["event"] as unknown as RuntimeEvent };
	}
	if (value["kind"] !== "result")
		return invalid("unknown Session worker record");
	const id = nonEmptyString(value["id"], "worker result id");
	if (value["ok"] === true)
		return { kind: "result", id, ok: true, value: value["value"] };
	if (value["ok"] === false)
		return {
			kind: "result",
			id,
			ok: false,
			error: nonEmptyString(value["error"], "worker result error"),
		};
	return invalid("worker result ok must be boolean");
};

export const encodeSessionWorkerRecord = (
	record: SessionWorkerRecord | SessionWorkerCommand,
): string => stringifyJsonl(record, { maxLineBytes: workerMaxLineBytes });

const objectInput = <A>(value: unknown, label: string): A =>
	isRecord(value) ? (value as A) : invalid(`${label} input must be an object`);

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
				nonEmptyString(command.input, "actionRunId"),
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
	const host = await createSessionHost(options);
	let writes = Promise.resolve();
	const write = (record: SessionWorkerRecord): Promise<void> => {
		writes = writes.then(() =>
			options.writeLine(encodeSessionWorkerRecord(record)),
		);
		return writes;
	};
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
					error: errorMessage(error),
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
					error: errorMessage(error),
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
