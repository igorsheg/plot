import { createConnection } from "node:net";
import { defineCommand, type ParsedArgs } from "citty";
import { getCliIo } from "../cli-context.js";
import { errorMessage, writeCliStderr } from "../io.js";
import { str } from "../options.js";
import { jsonlLines, stringifyJsonl } from "@plot/session/jsonl";
import { defaultProtocolLimits } from "@plot/session/protocol";
import type { RunIpcOptions } from "@plot/session/run-ipc";
import {
	resolveRunIpcSocketPath,
	sendRunIpcRequest,
} from "@plot/session/run-ipc";
import type { RunRequest } from "@plot/session/run-registry";

const runIpcOptions = (_args: ParsedArgs): RunIpcOptions => ({
	cwd: process.cwd(),
});

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const request = async (args: ParsedArgs, value: RunRequest) => {
	const io = getCliIo();
	try {
		await io.writeStdout(
			json(await sendRunIpcRequest(runIpcOptions(args), value)),
		);
	} catch (error) {
		await writeCliStderr(
			io,
			`Error: ${errorMessage(error)}\nFix: run \`plot web\` or \`plot api --http\`.\n`,
		);
		throw error;
	}
};

const streamEvents = async (args: ParsedArgs) => {
	const io = getCliIo();
	const runId = str(args, "runId");
	if (runId === undefined) throw new Error("run id required");
	const after = str(args, "after");
	const socket = createConnection(resolveRunIpcSocketPath(runIpcOptions(args)));
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		socket.write(
			stringifyJsonl(
				{
					type: "protocol_stream",
					id: runId,
					...(after === undefined ? {} : { afterSequence: Number(after) }),
				},
				{ maxLineBytes: defaultProtocolLimits.maxOutputLineBytes },
			),
		);
		for await (const line of jsonlLines(socket, {
			maxLineBytes: defaultProtocolLimits.maxOutputLineBytes,
		})) {
			// eslint-disable-next-line no-await-in-loop -- preserve streamed run output order.
			if (line.trim() !== "") await io.writeStdout(`${line}\n`);
		}
	} finally {
		socket.destroy();
	}
};

const runIdArg = {
	runId: {
		type: "positional",
		description: "Run id.",
		required: true,
	},
} as const;

export const listRunsCommand = defineCommand({
	meta: { name: "ls", description: "List Plot runs." },
	run: ({ args }) => request(args, { type: "list" }),
});

export const statusRunCommand = defineCommand({
	meta: { name: "status", description: "Show one Plot run." },
	args: runIdArg,
	run: ({ args }) => request(args, { type: "status", id: str(args, "runId")! }),
});

export const stopRunCommand = defineCommand({
	meta: { name: "stop", description: "Stop one Plot run." },
	args: runIdArg,
	run: ({ args }) => request(args, { type: "stop", id: str(args, "runId")! }),
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
	},
	run: ({ args }) => streamEvents(args),
});
