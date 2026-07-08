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
			if (eventType(next.value) !== type) continue;
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
