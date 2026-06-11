import { createInterface } from "node:readline/promises";
import { defineCommand } from "citty";
import { commonArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { runHumanCommand, writeProcessStderr } from "../io.js";
import { makeAuth, str } from "../options.js";
import { renderAuthStatus } from "../render.js";

const readPrompt = (message: string): Promise<string> => {
	const readline = createInterface({
		input: process.stdin,
		output: process.stderr,
	});
	return readline.question(`${message} `).finally(() => readline.close());
};

export const authCommand = defineCommand({
	meta: {
		name: "auth",
		description: "Manage provider authentication.",
	},
	args: {
		action: {
			type: "positional",
			description: "status, login, or logout.",
			required: false,
		},
		providerName: {
			type: "positional",
			description: "Provider id from `plot list-models`.",
			required: false,
		},
		...commonArgs,
	},
	run: ({ args }) => {
		const io = getCliIo();
		const sub = typeof args.action === "string" ? args.action : args._[0];
		const cwd = str(args, "cwd") ?? process.cwd();
		const plotDir = str(args, "plot-dir");
		const agentDir = str(args, "agent-dir");
		const auth = makeAuth({
			cwd,
			...(plotDir === undefined ? {} : { plotDir }),
			...(agentDir === undefined ? {} : { agentDir }),
		});
		const provider =
			(typeof args.providerName === "string" ? args.providerName : args._[1]) ??
			str(args, "provider");
		if (sub === "status")
			return runHumanCommand(
				io,
				auth.status(provider),
				renderAuthStatus,
				"Pass a provider id from `plot list-models`.",
			);
		if (sub === "logout" && provider)
			return runHumanCommand(
				io,
				auth.logout(provider).then(() => provider),
				(x) => `Logged out from ${x}.\n`,
				"Pass a valid provider id from `plot list-models`.",
			);
		if (sub === "login" && provider)
			return runHumanCommand(
				io,
				auth
					.login({
						provider,
						events: {
							auth: (info) => {
								void writeProcessStderr(
									`Open URL: ${info.url}\n${info.instructions ?? ""}\n`,
								);
							},
							deviceCode: (info) => {
								void writeProcessStderr(
									`Open ${info.verificationUri} and enter ${info.userCode}\n`,
								);
							},
							prompt: (prompt) => {
								void writeProcessStderr(`${prompt.message}\n`);
							},
							select: (prompt) => {
								void writeProcessStderr(
									`${prompt.message}: ${prompt.options.map((o) => o.label).join(", ")}\n`,
								);
							},
							progress: (message) => {
								void writeProcessStderr(`${message}\n`);
							},
						},
						promptInput: (prompt) => readPrompt(prompt.message),
						manualCodeInput: () =>
							readPrompt("Paste the authorization code or redirect URL:"),
						selectInput: async (prompt) =>
							(await readPrompt(prompt.message)).trim() ||
							prompt.options[0]?.id,
					})
					.then(() => provider),
				(x) => `Logged in to ${x}.\n`,
				"Run in an interactive terminal or use the protocol auth_login command with promptResponses.",
			);
		throw new Error("usage: plot auth status|login|logout [provider]");
	},
});
