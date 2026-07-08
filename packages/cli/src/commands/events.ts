import { defineCommand, type ParsedArgs } from "citty";
import { stringifyJsonl } from "@plot/common/jsonl";
import { errorMessage } from "@plot/common/primitives";
import {
	defaultProtocolLimits,
	type ServerRecord,
} from "@plot/session/protocol";
import { getCliIo } from "../cli-context.js";
import { writeCliStderr } from "../io.js";
import { str } from "../options.js";
import {
	jsonText,
	runControlFix,
	runRegistryArgs,
	streamRunProtocolRecords,
} from "../run-client.js";

const runIdArg = {
	runId: {
		type: "positional",
		description: "Run id. A unique prefix from `plot runs list` is accepted.",
		required: true,
	},
} as const;

const afterArg = {
	after: {
		type: "string",
		description: "Only read records after this event sequence.",
		valueHint: "sequence",
	},
} as const;

const parseAfterSequence = (args: ParsedArgs): number => {
	const after = str(args, "after");
	if (after === undefined) return 0;
	const sequence = Number(after);
	if (Number.isInteger(sequence) && sequence >= 0) return sequence;
	throw new Error("--after must be a non-negative integer");
};

const eventType = (record: ServerRecord): string | undefined => {
	if (record.kind !== "event") return undefined;
	if (record.event.kind === "agent_event") return "agent_event";
	return record.event.event.type;
};

interface EventFilterFields {
	readonly workKey?: string;
	readonly runId?: string;
	readonly sourceId?: string;
	readonly status?: string;
	readonly tickId?: string;
}

const eventFilterFields = (record: ServerRecord): EventFilterFields => {
	if (record.kind !== "event") return {};
	const event = record.event;
	if (event.kind === "agent_event")
		return {
			workKey: event.workKey,
			runId: event.runId,
			sourceId: event.sourceId,
		};
	const sessionEvent = event.event;
	if (sessionEvent.type === "tick_started")
		return { tickId: String(sessionEvent.tickId) };
	if (sessionEvent.type === "tick_completed")
		return { tickId: String(sessionEvent.result.tickId) };
	if (sessionEvent.type === "work_observed")
		return {
			workKey: sessionEvent.work.workKey,
			sourceId: sessionEvent.work.sourceId,
			status: sessionEvent.work.status,
		};
	if (sessionEvent.type === "work_removed")
		return { workKey: sessionEvent.workKey };
	if (sessionEvent.type === "wake_scheduled") {
		const fields: { workKey?: string } = {};
		if (sessionEvent.workKey !== undefined)
			fields.workKey = sessionEvent.workKey;
		return fields;
	}
	if (sessionEvent.type === "attempt_started")
		return {
			workKey: sessionEvent.run.workKey,
			runId: sessionEvent.run.runId,
			sourceId: sessionEvent.run.sourceId,
		};
	if (sessionEvent.type === "attempt_completed")
		return {
			workKey: sessionEvent.completion.workKey,
			runId: sessionEvent.completion.runId,
			sourceId: sessionEvent.completion.sourceId,
			status: sessionEvent.completion.status,
		};
	return {};
};

const filterValue = (args: ParsedArgs, field: string): string | undefined =>
	str(args, field);

const matchesEventFilters = (
	record: ServerRecord,
	args: ParsedArgs,
): boolean => {
	const fields = eventFilterFields(record);
	for (const [arg, value] of [
		["work-key", fields.workKey],
		["run-id", fields.runId],
		["source-id", fields.sourceId],
		["status", fields.status],
		["tick-id", fields.tickId],
	] as const) {
		const expected = filterValue(args, arg);
		if (expected !== undefined && value !== expected) return false;
	}
	return true;
};

const streamEvents = async (args: ParsedArgs) => {
	const io = getCliIo();
	try {
		const runId = str(args, "runId");
		if (runId === undefined) throw new Error("run id required");
		for await (const record of streamRunProtocolRecords(
			args,
			runId,
			parseAfterSequence(args),
		)) {
			await io.writeStdout(
				stringifyJsonl(record, {
					maxLineBytes: defaultProtocolLimits.maxOutputLineBytes,
				}),
			);
		}
	} catch (error) {
		await writeCliStderr(
			io,
			`Error: ${errorMessage(error)}\nFix: ${runControlFix(error)}\n`,
		);
		throw error;
	}
};

const waitForEvent = async (args: ParsedArgs) => {
	const io = getCliIo();
	let iterator: AsyncIterator<ServerRecord> | undefined;
	try {
		const runId = str(args, "runId");
		const type = str(args, "type");
		if (runId === undefined) throw new Error("run id required");
		if (type === undefined) throw new Error("--type is required");
		const timeoutMs = Number(str(args, "timeout-ms") ?? "0");
		const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : undefined;
		iterator = streamRunProtocolRecords(args, runId, parseAfterSequence(args))[
			Symbol.asyncIterator
		]();
		for (;;) {
			const remaining =
				deadline === undefined ? undefined : deadline - Date.now();
			if (remaining !== undefined && remaining <= 0)
				throw new Error(`timed out waiting for event type ${type}`);
			// eslint-disable-next-line no-await-in-loop -- wait scans live events in arrival order.
			const next = await (remaining === undefined
				? iterator.next()
				: Promise.race([
						iterator.next(),
						new Promise<"timeout">((resolve) =>
							setTimeout(() => resolve("timeout"), remaining),
						),
					]));
			if (next === "timeout")
				throw new Error(`timed out waiting for event type ${type}`);
			if (next.done === true)
				throw new Error(`stream closed before event type ${type}`);
			if (
				eventType(next.value) !== type ||
				!matchesEventFilters(next.value, args)
			)
				continue;
			// eslint-disable-next-line no-await-in-loop -- emit only the matched event before returning.
			await io.writeStdout(jsonText(next.value));
			return;
		}
	} catch (error) {
		await writeCliStderr(
			io,
			`Error: ${errorMessage(error)}\nFix: ${runControlFix(error)}\n`,
		);
		throw error;
	} finally {
		await iterator?.return?.();
	}
};

export const eventsStreamCommand = defineCommand({
	meta: {
		name: "stream",
		description: "Stream run protocol records as JSONL.",
	},
	args: { ...runIdArg, ...afterArg, ...runRegistryArgs },
	run: ({ args }) => streamEvents(args),
});

export const eventsWaitCommand = defineCommand({
	meta: {
		name: "wait",
		description: "Wait for one run event type and print it as JSON.",
	},
	args: {
		...runIdArg,
		type: {
			type: "string",
			description:
				"Session event type, or agent_event for relayed agent records.",
			valueHint: "event-type",
		},
		"timeout-ms": {
			type: "string",
			description: "Maximum wait in milliseconds. Default: no timeout.",
			valueHint: "ms",
		},
		"work-key": {
			type: "string",
			description: "Only match events for this Work Item key.",
			valueHint: "work-key",
		},
		"run-id": {
			type: "string",
			description: "Only match events for this Agent Run id.",
			valueHint: "run-id",
		},
		"source-id": {
			type: "string",
			description: "Only match events for this source id.",
			valueHint: "source-id",
		},
		status: {
			type: "string",
			description: "Only match events with this work or completion status.",
			valueHint: "status",
		},
		"tick-id": {
			type: "string",
			description: "Only match tick events for this tick id.",
			valueHint: "tick-id",
		},
		...afterArg,
		...runRegistryArgs,
	},
	run: ({ args }) => waitForEvent(args),
});

export const eventsCommand = defineCommand({
	meta: { name: "events", description: "Stream and wait for live run events." },
	subCommands: {
		stream: eventsStreamCommand,
		wait: eventsWaitCommand,
	},
});
