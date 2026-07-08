import { createInterface } from "node:readline/promises";
import { defineCommand, type ParsedArgs } from "citty";
import { authPathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { openBrowser, runHumanCommand, writeProcessStderr } from "../io.js";
import { makeAuthFromArgs, str } from "../options.js";
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

const optionalProviderArg = {
	providerName: {
		type: "positional",
		description: "Optional provider id from `plot models`.",
		required: false,
	},
} as const;

const selectLoginProvider = async (
	providers: readonly {
		readonly id: string;
		readonly name: string;
		readonly configured: boolean;
	}[],
): Promise<string> => {
	if (providers.length === 0)
		throw new Error("No auth providers found. Run `plot models` first.");
	const selected = await readSelect({
		message: "Choose a provider to log in:",
		options: providers.map((provider) => ({
			id: provider.id,
			label: `${provider.id} - ${provider.name}${provider.configured ? " (configured)" : ""}`,
		})),
	});
	if (selected === undefined) throw new Error("provider selection required");
	return selected;
};

const selectLogoutProvider = async (
	providers: readonly {
		readonly id: string;
		readonly name: string;
		readonly configured: boolean;
	}[],
): Promise<string> => {
	const configured = providers.filter((provider) => provider.configured);
	if (configured.length === 0)
		throw new Error("No configured auth providers found.");
	const selected = await readSelect({
		message: "Choose a provider to log out:",
		options: configured.map((provider) => ({
			id: provider.id,
			label: `${provider.id} - ${provider.name}`,
		})),
	});
	if (selected === undefined) throw new Error("provider selection required");
	return selected;
};

const runLogout = (args: ParsedArgs) => {
	const auth = makeAuthFromArgs(args);
	return runHumanCommand(
		getCliIo(),
		(async () => {
			const provider =
				str(args, "providerName") ??
				(await selectLogoutProvider(await auth.providers()));
			await auth.logout(provider);
			return provider;
		})(),
		(x) => `Logged out from ${x}.\n`,
		"Pass a valid provider id from `plot models`.",
	);
};

const runLogin = (args: ParsedArgs) => {
	const auth = makeAuthFromArgs(args);
	return runHumanCommand(
		getCliIo(),
		(async () => {
			const provider =
				str(args, "providerName") ??
				(await selectLoginProvider(await auth.providers()));
			await auth.login({
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
			});
			return provider;
		})(),
		(x) => `Logged in to ${x}.\n`,
		"Run in an interactive terminal and provide the provider login prompts.",
	);
};

const runStatus = (args: ParsedArgs) =>
	runHumanCommand(
		getCliIo(),
		makeAuthFromArgs(args).status(),
		renderAuthStatus,
		"Run `plot auth login` or pass valid --cwd/--plot-dir/--agent-dir paths.",
	);

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
			args: authPathArgs,
			run: ({ args }) => runStatus(args),
		}),
		login: defineCommand({
			meta: {
				name: "login",
				description: "Start an interactive provider login.",
			},
			args: {
				...optionalProviderArg,
				...authPathArgs,
			},
			run: ({ args }) => runLogin(args),
		}),
		logout: defineCommand({
			meta: {
				name: "logout",
				description: "Remove stored authentication for a provider.",
			},
			args: {
				...optionalProviderArg,
				...authPathArgs,
			},
			run: ({ args }) => runLogout(args),
		}),
	},
});
