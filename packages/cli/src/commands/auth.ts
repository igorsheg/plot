import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { defineCommand } from "citty";
import type { Mutable } from "@plot/common/primitives";
import { authPathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { runHumanCommand, writeProcessStderr } from "../io.js";
import { makeAuth, str } from "../options.js";
import { renderAuthStatus } from "../render.js";

interface SelectPrompt {
	readonly message: string;
	readonly options: readonly { readonly id: string; readonly label: string }[];
}

const readPrompt = (message: string): Promise<string> => {
	const readline = createInterface({
		input: process.stdin,
		output: process.stderr,
	});
	return readline.question(`${message} `).finally(() => readline.close());
};

const comparableLabel = (value: string) =>
	value
		.toLowerCase()
		.replace(/\s*\([^)]*\)\s*$/, "")
		.trim();

export const selectOptionId = (
	prompt: SelectPrompt,
	input: string,
): string | undefined => {
	const value = input.trim();
	if (value.length === 0) return prompt.options[0]?.id;
	const numbered = Number(value);
	if (Number.isInteger(numbered) && numbered >= 1)
		return prompt.options[numbered - 1]?.id;
	const normalized = value.toLowerCase();
	const normalizedLabel = comparableLabel(value);
	return prompt.options.find(
		(option) =>
			option.id.toLowerCase() === normalized ||
			option.label.toLowerCase() === normalized ||
			comparableLabel(option.label) === normalizedLabel,
	)?.id;
};

const openBrowser = (url: string): void => {
	const [command, args]: [string, string[]] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["rundll32", ["url.dll,FileProtocolHandler", url]]
				: ["xdg-open", [url]];
	spawn(command, args, { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
};

const readSelect = async (
	prompt: SelectPrompt,
): Promise<string | undefined> => {
	const lines = [
		prompt.message.replace(/:+$/, ":"),
		...prompt.options.map((option, index) => `  ${index + 1}. ${option.label}`),
	];
	await writeProcessStderr(`${lines.join("\n")}\n`);
	for (;;) {
		// eslint-disable-next-line no-await-in-loop -- interactive prompt retries are sequential.
		const response = await readPrompt("Choose [1]:");
		const selected = selectOptionId(prompt, response);
		if (selected !== undefined) return selected;
		// eslint-disable-next-line no-await-in-loop -- show validation before asking again.
		await writeProcessStderr("Enter a number from the list.\n");
	}
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
	const options: Mutable<Parameters<typeof makeAuth>[0]> = { cwd };
	if (plotDir !== undefined) options.plotDir = plotDir;
	if (agentDir !== undefined) options.agentDir = agentDir;
	return makeAuth(options);
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
									openBrowser(info.url);
									void writeProcessStderr(
										`Opening browser: ${info.url}\n${info.instructions ?? "If it did not open, copy the URL above."}\n`,
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

								progress: (message) => {
									void writeProcessStderr(`${message}\n`);
								},
							},
							promptInput: (prompt) => readPrompt(prompt.message),
							manualCodeInput: () =>
								readPrompt("Paste the authorization code or redirect URL:"),
							selectInput: readSelect,
						})
						.then(() => provider),
					(x) => `Logged in to ${x}.\n`,
					"Run in an interactive terminal and provide the provider login prompts.",
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
