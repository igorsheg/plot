import { defineCommand, type ParsedArgs } from "citty";
import { stringifyJsonl } from "@plot/common/jsonl";
import { errorMessage, type Mutable } from "@plot/common/primitives";
import { defaultProtocolLimits } from "@plot/session/protocol";
import { sendRunIpcRequest, streamRunRecords } from "@plot/registry/ipc";
import type { RunIpcOptions, RunRequest } from "@plot/registry/ipc";
import { runRegistryArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { writeCliStderr } from "../io.js";
import { str } from "../options.js";
import { formatRunResponse } from "../run-output.js";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

class RunIdResolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RunIdResolutionError";
	}
}

const runIpcOptions = (args: ParsedArgs): RunIpcOptions => {
	const options: Mutable<RunIpcOptions> = {
		cwd: str(args, "cwd") ?? process.cwd(),
	};
	const runRegistryDir = str(args, "registry-dir");
	if (runRegistryDir !== undefined) options.runRegistryDir = runRegistryDir;
	return options;
};

const runControlFix = (error: unknown): string =>
	error instanceof RunIdResolutionError
		? "Use `plot runs list` to copy a current run id. Short unique prefixes are accepted."
		: "Start the daemon with `plot serve registry`, `plot open`, or `plot open --web`.";

const request = async (args: ParsedArgs, value: RunRequest) => {
	const io = getCliIo();
	try {
		const response = await sendRunIpcRequest(runIpcOptions(args), value);
		await io.writeStdout(
			args["json"] === true
				? json(response)
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

export const resolveRunIdPrefix = (
	input: string,
	runs: readonly { readonly id: string }[],
): string => {
	const matches = runs.filter((run) => run.id.startsWith(input));
	if (matches.length === 1) return matches[0]!.id;
	if (matches.length === 0)
		throw new RunIdResolutionError(`Run not found: ${input}`);
	throw new RunIdResolutionError(
		`Run id "${input}" is ambiguous: ${matches.map((run) => run.id.slice(0, 8)).join(", ")}`,
	);
};

const resolveRunId = async (
	args: ParsedArgs,
	input: string,
): Promise<string> => {
	if (input.length >= 36) return input;
	const response = await sendRunIpcRequest(runIpcOptions(args), {
		type: "list",
	});
	if (response.type === "error") throw new Error(response.error);
	if (response.type !== "list_result")
		throw new Error(`Unexpected run list response: ${response.type}`);
	return resolveRunIdPrefix(input, response.runs);
};

const requestRun = async (args: ParsedArgs, type: "status" | "stop") => {
	const runId = str(args, "runId");
	if (runId === undefined) throw new Error("run id required");
	let id: string;
	try {
		id = await resolveRunId(args, runId);
	} catch (error) {
		await writeCliStderr(
			getCliIo(),
			`Error: ${errorMessage(error)}\nFix: ${runControlFix(error)}\n`,
		);
		throw error;
	}
	if (type === "status") return request(args, { type: "status", id });
	return request(args, { type: "stop", id });
};

const jsonFlag = {
	json: {
		type: "boolean",
		description: "Print the raw IPC response as JSON.",
		default: false,
	},
} as const;

const parseAfterSequence = (args: ParsedArgs): number => {
	const after = str(args, "after");
	if (after === undefined) return 0;
	const sequence = Number(after);
	if (Number.isInteger(sequence) && sequence >= 0) return sequence;
	throw new RunIdResolutionError("--after must be a non-negative integer");
};

const streamEvents = async (args: ParsedArgs) => {
	const io = getCliIo();
	try {
		const runId = str(args, "runId");
		if (runId === undefined) throw new Error("run id required");
		const id = await resolveRunId(args, runId);
		for await (const record of streamRunRecords(
			runIpcOptions(args),
			id,
			parseAfterSequence(args),
		)) {
			// eslint-disable-next-line no-await-in-loop -- preserve streamed run output order.
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
	meta: { name: "logs", description: "Stream run protocol records." },
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
