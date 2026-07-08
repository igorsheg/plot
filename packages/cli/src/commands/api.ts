import { defineCommand, type ParsedArgs } from "citty";
import {
	sessionProtocolSchema,
	type SessionProtocolMethod,
} from "@plot/session/protocol";
import { getCliIo } from "../cli-context.js";
import { str } from "../options.js";
import {
	jsonText,
	runRegistryArgs,
	submitRunProtocolRequest,
	writeRunControlError,
} from "../run-client.js";

const runIdArg = {
	runId: {
		type: "positional",
		description:
			"Live run id. A unique prefix from `plot runs list` is accepted.",
		required: true,
	},
} as const;

const writeProtocolRecord = async (
	runId: string | undefined,
	method: SessionProtocolMethod,
	args: ParsedArgs,
) => {
	if (runId === undefined) throw new Error("run id required");
	try {
		const record = await submitRunProtocolRequest(args, runId, method);
		await getCliIo().writeStdout(jsonText(record));
	} catch (error) {
		await writeRunControlError(error);
		throw error;
	}
};

export const apiSchemaCommand = defineCommand({
	meta: {
		name: "schema",
		description: "Print the Plot session protocol schema.",
	},
	args: {
		json: {
			type: "boolean",
			description: "Print the schema as JSON. This is the default.",
			default: true,
		},
	},
	run: async () => {
		await getCliIo().writeStdout(jsonText(sessionProtocolSchema));
	},
});

export const apiPingCommand = defineCommand({
	meta: {
		name: "ping",
		description: "Ping a live run through the session protocol.",
	},
	args: { ...runIdArg, ...runRegistryArgs },
	run: ({ args }) => writeProtocolRecord(str(args, "runId"), "ping", args),
});

export const apiSnapshotCommand = defineCommand({
	meta: {
		name: "snapshot",
		description: "Print a live run session snapshot through the protocol.",
	},
	args: { ...runIdArg, ...runRegistryArgs },
	run: ({ args }) =>
		writeProtocolRecord(str(args, "runId"), "session.snapshot", args),
});

export const apiCommand = defineCommand({
	meta: {
		name: "api",
		description: "Inspect and call Plot's public session protocol.",
	},
	subCommands: {
		schema: apiSchemaCommand,
		ping: apiPingCommand,
		snapshot: apiSnapshotCommand,
	},
});
