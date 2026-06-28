import { createConnection } from "node:net";
import { defineCommand, type ParsedArgs } from "citty";
import { pathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { errorMessage, writeCliStderr } from "../io.js";
import { str } from "../options.js";
import type { FleetIpcOptions } from "@plot/session/fleet-ipc";
import {
	resolveFleetIpcSocketPath,
	sendFleetIpcRequest,
} from "@plot/session/fleet-ipc";
import type { FleetRequest } from "@plot/session/fleet";

const fleetOptions = (_args: ParsedArgs): FleetIpcOptions => ({
	cwd: process.cwd(),
});

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const request = async (args: ParsedArgs, value: FleetRequest) => {
	const io = getCliIo();
	try {
		await io.writeStdout(
			json(await sendFleetIpcRequest(fleetOptions(args), value)),
		);
	} catch (error) {
		await writeCliStderr(
			io,
			`Error: ${errorMessage(error)}\nFix: run \`plot serve fleet\` or \`plot web\`.\n`,
		);
		throw error;
	}
};

const streamEvents = async (args: ParsedArgs) => {
	const io = getCliIo();
	const instanceId = str(args, "instanceId");
	if (instanceId === undefined) throw new Error("instance id required");
	const after = str(args, "after");
	const socket = createConnection(
		resolveFleetIpcSocketPath(fleetOptions(args)),
	);
	await new Promise<void>((resolve, reject) => {
		socket.once("connect", resolve);
		socket.once("error", reject);
	});
	socket.write(
		`${JSON.stringify({
			type: "protocol_stream",
			id: instanceId,
			...(after === undefined ? {} : { afterSequence: Number(after) }),
		})}\n`,
	);
	let buffer = "";
	await new Promise<void>((resolve, reject) => {
		socket.on("error", reject);
		socket.on("end", resolve);
		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();
			void (async () => {
				for (;;) {
					const index = buffer.indexOf("\n");
					if (index === -1) return;
					const line = buffer.slice(0, index);
					buffer = buffer.slice(index + 1);
					if (line.trim() !== "") {
						// eslint-disable-next-line no-await-in-loop -- preserve streamed instance output order.
						await io.writeStdout(`${line}\n`);
					}
				}
			})().catch(reject);
		});
	});
};

export const instancesCommand = defineCommand({
	meta: {
		name: "instances",
		description: "Debug Plot fleet instances.",
	},
	subCommands: {
		list: defineCommand({
			meta: { name: "list", description: "List fleet instances." },
			run: ({ args }) => request(args, { type: "list" }),
		}),
		spawn: defineCommand({
			meta: { name: "spawn", description: "Spawn a fleet instance." },
			args: {
				cwd: pathArgs.cwd,
				workflow: {
					type: "string",
					description: "Workflow file for the new instance.",
					valueHint: "path",
				},
				label: {
					type: "string",
					description: "Human label for the new instance.",
					valueHint: "text",
				},
			},
			run: ({ args }) => {
				const workflowPath = str(args, "workflow");
				const label = str(args, "label");
				return request(args, {
					type: "spawn",
					options: {
						cwd: str(args, "cwd") ?? process.cwd(),
						...(workflowPath === undefined ? {} : { workflowPath }),
						...(label === undefined ? {} : { label }),
					},
				});
			},
		}),
		status: defineCommand({
			meta: { name: "status", description: "Show one fleet instance." },
			args: {
				instanceId: {
					type: "positional",
					description: "Instance id.",
					required: true,
				},
			},
			run: ({ args }) =>
				request(args, { type: "status", id: str(args, "instanceId")! }),
		}),
		stop: defineCommand({
			meta: { name: "stop", description: "Stop one fleet instance." },
			args: {
				instanceId: {
					type: "positional",
					description: "Instance id.",
					required: true,
				},
			},
			run: ({ args }) =>
				request(args, { type: "stop", id: str(args, "instanceId")! }),
		}),
		events: defineCommand({
			meta: {
				name: "events",
				description: "Stream instance protocol records.",
			},
			args: {
				instanceId: {
					type: "positional",
					description: "Instance id.",
					required: true,
				},
				after: {
					type: "string",
					description: "Only stream records after this event sequence.",
					valueHint: "sequence",
				},
			},
			run: ({ args }) => streamEvents(args),
		}),
	},
});
