import { createInterface } from "node:readline/promises";
import { defineCommand } from "citty";
import { authPathArgs } from "../args.js";
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

const providerArg = {
	providerName: {
		type: "positional",
		description: "Provider id from `plot list-models`.",
		required: true,
	},
} as const;

const optionalProviderArg = {
	providerName: {
		type: "positional",
		description: "Optional provider id from `plot list-models`.",
		required: false,
	},
} as const;

const makeAuthFromArgs = (args: Record<string, unknown>) => {
	const cwd = str(args, "cwd") ?? process.cwd();
	const plotDir = str(args, "plot-dir");
	const agentDir = str(args, "agent-dir");
	return makeAuth({
		cwd,
		...(plotDir === undefined ? {} : { plotDir }),
		...(agentDir === undefined ? {} : { agentDir }),
	});
};

export const authCommand = defineCommand({
	meta: {
		name: "auth",
		description: "Manage provider authentication.",
	},
	subCommands: {
		status: defineCommand({
			meta: {
				name: "status",
				description: "Show provider authentication status.",
			},
			args: {
				...optionalProviderArg,
				...authPathArgs,
			},
			run: ({ args }) => {
				const provider = str(args, "providerName");
				return runHumanCommand(
					getCliIo(),
					makeAuthFromArgs(args).status(provider),
					renderAuthStatus,
					"Pass a provider id from `plot list-models`.",
				);
			},
		}),
		login: defineCommand({
			meta: {
				name: "login",
				description: "Start an interactive provider login.",
			},
			args: {
				...providerArg,
				...authPathArgs,
			},
			run: ({ args }) => {
				const provider = str(args, "providerName")!;
				return runHumanCommand(
					getCliIo(),
					makeAuthFromArgs(args)
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
			},
		}),
		logout: defineCommand({
			meta: {
				name: "logout",
				description: "Remove stored authentication for a provider.",
			},
			args: {
				...providerArg,
				...authPathArgs,
			},
			run: ({ args }) => {
				const provider = str(args, "providerName")!;
				return runHumanCommand(
					getCliIo(),
					makeAuthFromArgs(args)
						.logout(provider)
						.then(() => provider),
					(x) => `Logged out from ${x}.\n`,
					"Pass a valid provider id from `plot list-models`.",
				);
			},
		}),
	},
});
