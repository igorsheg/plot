import {
	parseBoundaryErrorRecord,
	PlotBoundaryError,
	toBoundaryErrorRecord,
	type BoundaryErrorRecord,
} from "@plot/common/boundary-error";
import { isRecord } from "@plot/common/primitives";
import {
	createSessionHost,
	type CreateSessionHostOptions,
	type SessionHost,
} from "./host.js";
import {
	decodeOperatorObservation,
	decodeRuntimeEvent,
	decodeSourceActionInput,
	type OperatorObservationInput,
	type RuntimeEvent,
	type SourceActionInput,
} from "./runtime.js";

interface WorkerCommandBase {
	readonly kind: "command";
	readonly id: string;
}

export type SessionWorkerCommand =
	| (WorkerCommandBase & { readonly action: "start" | "shutdown" | "tick" })
	| (WorkerCommandBase & {
			readonly action: "observe";
			readonly input: OperatorObservationInput;
	  })
	| (WorkerCommandBase & {
			readonly action: "source-action";
			readonly input: SourceActionInput;
	  })
	| (WorkerCommandBase & {
			readonly action: "source-action-cancel";
			readonly input: string;
	  });

export type SessionWorkerAction = SessionWorkerCommand["action"];

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

const text = (
	value: unknown,
	label: string,
	invalid: (message: string) => never,
): string =>
	typeof value === "string" && value.length > 0
		? value
		: invalid(`${label} must be a non-empty string`);

export const decodeSessionWorkerCommand = (
	value: unknown,
): SessionWorkerCommand => {
	if (!isRecord(value) || value["kind"] !== "command")
		return invalidCommand("invalid Session worker command");
	const id = text(value["id"], "worker command id", invalidCommand);
	const action = text(value["action"], "worker action", invalidCommand);
	if (action === "start" || action === "shutdown" || action === "tick") {
		if (value["input"] !== undefined)
			return invalidCommand(`${action} cannot carry input`);
		return { kind: "command", id, action };
	}
	if (action === "observe")
		return {
			kind: "command",
			id,
			action,
			input: decodeOperatorObservation(value["input"]),
		};
	if (action === "source-action")
		return {
			kind: "command",
			id,
			action,
			input: decodeSourceActionInput(value["input"]),
		};
	if (action === "source-action-cancel")
		return {
			kind: "command",
			id,
			action,
			input: text(value["input"], "actionRunId", invalidCommand),
		};
	return invalidCommand(`unknown Session worker action: ${action}`);
};

export const decodeSessionWorkerRecord = (
	value: unknown,
): SessionWorkerRecord => {
	if (!isRecord(value)) return invalidRecord("invalid Session worker record");
	if (value["kind"] === "ready")
		return {
			kind: "ready",
			sessionId: text(value["sessionId"], "sessionId", invalidRecord),
			workflowName: text(value["workflowName"], "workflowName", invalidRecord),
			workflowPath: text(value["workflowPath"], "workflowPath", invalidRecord),
			projectPath: text(value["projectPath"], "projectPath", invalidRecord),
			historyPath: text(value["historyPath"], "historyPath", invalidRecord),
		};
	if (value["kind"] === "event")
		return { kind: "event", event: decodeRuntimeEvent(value["event"]) };
	if (value["kind"] === "failure")
		return { kind: "failure", error: parseBoundaryErrorRecord(value["error"]) };
	if (value["kind"] !== "result")
		return invalidRecord("unknown Session worker record");
	const id = text(value["id"], "worker result id", invalidRecord);
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

const handleCommand = async (
	host: SessionHost,
	command: SessionWorkerCommand,
): Promise<unknown> => {
	switch (command.action) {
		case "start":
			await host.runtime.start();
			return true;
		case "shutdown":
			await host.shutdown();
			return true;
		case "tick":
			return host.runtime.tickOnce();
		case "observe":
			return host.runtime.recordOperatorObservation(command.input);
		case "source-action":
			return host.runtime.startSourceAction(command.input);
		case "source-action-cancel":
			return host.runtime.cancelSourceAction(command.input);
	}
};

const sendWorkerRecord = (record: SessionWorkerRecord): void => {
	if (process.send === undefined)
		throw new Error("Session worker requires parent IPC");
	process.send(record);
};

export const serveSessionWorker = async (
	options: CreateSessionHostOptions,
): Promise<void> => {
	let host: SessionHost;
	try {
		host = await createSessionHost(options);
	} catch (error) {
		sendWorkerRecord({
			kind: "failure",
			error: toBoundaryErrorRecord(error, "session-worker-startup"),
		});
		return;
	}
	sendWorkerRecord({
		kind: "ready",
		sessionId: host.runtime.id,
		workflowName: host.metadata.workflowName,
		workflowPath: host.metadata.workflowPath,
		projectPath: host.metadata.cwd,
		historyPath: host.metadata.historyPath,
	});
	const controller = new AbortController();
	let finish!: (error?: unknown) => void;
	const done = new Promise<void>((resolve, reject) => {
		finish = (error) => (error === undefined ? resolve() : reject(error));
	});
	let commands = Promise.resolve();
	const onMessage = (value: unknown) => {
		commands = commands.then(async () => {
			let command: SessionWorkerCommand;
			try {
				command = decodeSessionWorkerCommand(value);
			} catch (error) {
				sendWorkerRecord({
					kind: "result",
					id: "invalid",
					ok: false,
					error: toBoundaryErrorRecord(error, "session-worker-command"),
				});
				return;
			}
			try {
				const result = await handleCommand(host, command);
				sendWorkerRecord({
					kind: "result",
					id: command.id,
					ok: true,
					value: result,
				});
			} catch (error) {
				sendWorkerRecord({
					kind: "result",
					id: command.id,
					ok: false,
					error: toBoundaryErrorRecord(error, "session-worker-runtime"),
				});
			}
			if (command.action === "shutdown") finish();
			return undefined;
		});
		commands.catch(finish);
	};
	const disconnected = () => finish();
	process.on("message", onMessage);
	process.once("disconnect", disconnected);
	const events = (async () => {
		for await (const event of host.runtime.events(controller.signal))
			sendWorkerRecord({ kind: "event", event });
	})().catch(finish);
	try {
		await done;
		await commands;
	} finally {
		process.off("message", onMessage);
		process.off("disconnect", disconnected);
		await host.shutdown().catch(() => undefined);
		controller.abort();
		await events;
	}
};
