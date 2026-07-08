import { defineCommand, type ParsedArgs } from "citty";
import { stringifyJsonl } from "@plot/common/jsonl";
import { errorMessage } from "@plot/common/primitives";
import { defaultProtocolLimits } from "@plot/session/protocol";
import { getCliIo } from "../cli-context.js";
import { writeCliStderr } from "../io.js";
import { str } from "../options.js";
import { formatRunResponse } from "../run-output.js";
import {
	jsonText,
	resolveRunId,
	resolveRunIdPrefix,
	runControlFix,
	runRegistryArgs,
	sendRunRequest,
	streamRunProtocolRecords,
	writeRunControlError,
} from "../run-client.js";

export { resolveRunIdPrefix };

const request = async (
	args: ParsedArgs,
	value: Parameters<typeof sendRunRequest>[1],
) => {
	const io = getCliIo();
	try {
		const response = await sendRunRequest(args, value);
		await io.writeStdout(
			args["json"] === true
				? jsonText(response)
				: `${formatRunResponse(response)}\n`,
		);
	} catch (error) {
		await writeCliStderr(
			io,
			`Error: ${errorMessage(error)}\nFix: ${runControlFix(error)}\n`,
		);
		throw error;
	}
};

const requestRun = async (args: ParsedArgs, type: "status" | "stop") => {
	const runId = str(args, "runId");
	if (runId === undefined) throw new Error("run id required");
	let id: string;
	try {
		id = await resolveRunId(args, runId);
	} catch (error) {
		await writeRunControlError(error);
		throw error;
	}
	if (type === "status") return request(args, { type: "status", id });
	return request(args, { type: "stop", id });
};

const jsonFlag = {
	json: {
		type: "boolean",
		description: "Print the raw response as JSON.",
		default: false,
	},
} as const;

const parseAfterSequence = (args: ParsedArgs): number => {
	const after = str(args, "after");
	if (after === undefined) return 0;
	const sequence = Number(after);
	if (Number.isInteger(sequence) && sequence >= 0) return sequence;
	throw new Error("--after must be a non-negative integer");
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

const runIdArg = {
	runId: {
		type: "positional",
		description: "Run id. A unique prefix from `plot runs list` is accepted.",
		required: true,
	},
} as const;

export const listRunsCommand = defineCommand({
	meta: { name: "list", description: "List Plot runs." },
	args: { ...runRegistryArgs, ...jsonFlag },
	run: ({ args }) => request(args, { type: "list" }),
});

export const cleanRunsCommand = defineCommand({
	meta: {
		name: "clean",
		description: "Remove stopped and errored runs and their history.",
	},
	args: { ...runRegistryArgs, ...jsonFlag },
	run: ({ args }) => request(args, { type: "prune" }),
});

export const showRunCommand = defineCommand({
	meta: { name: "show", description: "Show one Plot run." },
	args: { ...runIdArg, ...runRegistryArgs, ...jsonFlag },
	run: ({ args }) => requestRun(args, "status"),
});

export const stopRunCommand = defineCommand({
	meta: { name: "stop", description: "Stop one Plot run." },
	args: { ...runIdArg, ...runRegistryArgs, ...jsonFlag },
	run: ({ args }) => requestRun(args, "stop"),
});

export const logsRunCommand = defineCommand({
	meta: { name: "logs", description: "Stream run protocol records as JSONL." },
	args: {
		...runIdArg,
		after: {
			type: "string",
			description: "Only stream records after this event sequence.",
			valueHint: "sequence",
		},
		...runRegistryArgs,
	},
	run: ({ args }) => streamEvents(args),
});

export const runsCommand = defineCommand({
	meta: { name: "runs", description: "Inspect and manage Plot runs." },
	subCommands: {
		list: listRunsCommand,
		show: showRunCommand,
		logs: logsRunCommand,
		stop: stopRunCommand,
		clean: cleanRunsCommand,
	},
});
