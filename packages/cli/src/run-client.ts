import { randomUUID } from "node:crypto";
import type { ParsedArgs } from "citty";
import { errorMessage } from "@plot/common/primitives";
import {
	sendRunIpcRequest,
	streamRunRecordsGapless,
	type RunIpcOptions,
	type RunRequest,
} from "@plot/registry/ipc";
import {
	sessionProtocolVersion,
	type ClientRequest,
	type ServerRecord,
	type SessionProtocolMethod,
} from "@plot/session/protocol";
import { runRegistryArgs } from "./args.js";
import { getCliIo } from "./cli-context.js";
import { writeCliStderr } from "./io.js";
import { str } from "./options.js";

export { runRegistryArgs };

export const jsonText = (value: unknown) =>
	`${JSON.stringify(value, null, 2)}\n`;

export class RunIdResolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RunIdResolutionError";
	}
}

export const runIpcOptions = (args: ParsedArgs): RunIpcOptions =>
	({
		cwd: str(args, "cwd") ?? process.cwd(),
		runRegistryDir: str(args, "registry-dir"),
	}) as RunIpcOptions;

export const runControlFix = (error: unknown): string =>
	error instanceof RunIdResolutionError
		? "Use `plot runs list` to copy a current run id. Short unique prefixes are accepted."
		: "Start the daemon with `plot serve registry`, `plot open`, or `plot open --web`.";

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

export const resolveRunId = async (
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

export const sendRunRequest = async (args: ParsedArgs, value: RunRequest) =>
	sendRunIpcRequest(runIpcOptions(args), value);

export const writeRunControlError = async (error: unknown): Promise<void> => {
	await writeCliStderr(
		getCliIo(),
		`Error: ${errorMessage(error)}\nFix: ${runControlFix(error)}\n`,
	);
};

export const protocolRequest = (
	method: SessionProtocolMethod,
	params?: unknown,
): ClientRequest => ({
	protocol: sessionProtocolVersion,
	kind: "request",
	id: `cli_${method.replaceAll(".", "_")}_${randomUUID()}`,
	method,
	params,
});

export const submitRunProtocolRequest = async (
	args: ParsedArgs,
	runIdInput: string,
	method: SessionProtocolMethod,
	params?: unknown,
): Promise<ServerRecord> => {
	const id = await resolveRunId(args, runIdInput);
	const response = await sendRunRequest(args, {
		type: "protocol_request",
		id,
		request: protocolRequest(method, params),
	});
	if (response.type === "error") throw new Error(response.error);
	if (response.type !== "protocol_response")
		throw new Error(`Unexpected protocol response: ${response.type}`);
	return response.record;
};

export const streamRunProtocolRecords = async function* (
	args: ParsedArgs,
	runIdInput: string,
	afterSequence: number,
): AsyncIterable<ServerRecord> {
	const id = await resolveRunId(args, runIdInput);
	yield* streamRunRecordsGapless(runIpcOptions(args), id, afterSequence);
};
