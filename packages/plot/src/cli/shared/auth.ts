import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type {
	OAuthLoginCallbacks,
	OAuthProviderInterface,
} from "@mariozechner/pi-ai";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { CliError, writeNdjson, readNdjson } from "./io.js";
import { emitResult, emitError } from "./envelope.js";
import { lookupError } from "./errors.js";

function getEnv(name: string) {
	if (typeof process === "undefined") {
		return undefined;
	}
	return process.env[name];
}

function joinPath(...parts: string[]) {
	return parts
		.map((part) => part.replace(/\\/g, "/"))
		.filter((part) => part.length > 0)
		.join("/")
		.replace(/\/+/g, "/");
}

function getDefaultPlotAgentDir() {
	const homeDir = getEnv("HOME") ?? getEnv("USERPROFILE");
	return homeDir ? joinPath(homeDir, ".plot", "agent") : ".plot/agent";
}

function getPlotAgentDir() {
	return getEnv("PLOT_CODING_AGENT_DIR") ?? getDefaultPlotAgentDir();
}

function getPlotAuthPath() {
	return joinPath(getPlotAgentDir(), "auth.json");
}

function openBrowser(url: string) {
	const cmd =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "start"
				: "xdg-open";
	const proc = Bun.spawn([cmd, url], {
		stdio: ["ignore", "ignore", "ignore"],
	});
	proc.exited.catch(() => undefined);
}

async function promptLine(message: string) {
	const rl = createInterface({ input, output });
	try {
		return (await rl.question(message)).trim();
	} finally {
		rl.close();
	}
}

async function chooseProvider(
	providers: OAuthProviderInterface[],
	providerId?: string,
): Promise<OAuthProviderInterface> {
	if (providerId) {
		const provider = providers.find((entry) => entry.id === providerId);
		if (!provider) {
			throw new CliError("usage", `unknown provider: ${providerId}`, 2);
		}
		return provider;
	}

	if (providers.length === 0) {
		throw new CliError("startup", "no oauth providers available", 1);
	}

	if (providers.length === 1) {
		const onlyProvider = providers[0];
		if (!onlyProvider) {
			throw new CliError("startup", "no oauth providers available", 1);
		}
		return onlyProvider;
	}

	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new CliError(
			"usage",
			"multiple oauth providers available; specify one explicitly",
			2,
		);
	}

	writeBlock(
		"available providers:",
		providers.map(
			(provider, index) => `${index + 1}. ${provider.id} — ${provider.name}`,
		),
	);

	const answer = await promptLine("choose provider: ");
	const selectedIndex = Number(answer) - 1;
	const indexedProvider = providers[selectedIndex];
	if (Number.isInteger(selectedIndex) && indexedProvider) {
		return indexedProvider;
	}

	const selected = providers.find((provider) => provider.id === answer);
	if (!selected) {
		throw new CliError("usage", `unknown provider selection: ${answer}`, 2);
	}
	return selected;
}

export function createPlotAuthStorage() {
	return AuthStorage.create(getPlotAuthPath());
}

export async function loginWithPlotAuth(providerId?: string) {
	const authStorage = createPlotAuthStorage();
	const provider = await chooseProvider(
		authStorage.getOAuthProviders(),
		providerId,
	);

	const callbacks: OAuthLoginCallbacks = {
		onAuth: ({ url, instructions }: { url: string; instructions?: string }) => {
			process.stderr.write(`open this url to authenticate:\n${url}\n`);
			if (instructions) {
				process.stderr.write(`${instructions}\n`);
			}
			try {
				openBrowser(url);
			} catch {
				// best effort only
			}
		},
		onPrompt: async ({
			message,
			placeholder,
			allowEmpty,
		}: {
			message: string;
			placeholder?: string;
			allowEmpty?: boolean;
		}) => {
			const suffix = placeholder ? ` (${placeholder})` : "";
			const answer = await promptLine(`${message}${suffix}: `);
			if (!allowEmpty && answer.length === 0) {
				throw new CliError("usage", "input cannot be empty", 2);
			}
			return answer;
		},
		onManualCodeInput: () => promptLine("paste authorization code: "),
		onProgress: (message: string) => {
			process.stderr.write(`${message}\n`);
		},
	};

	await authStorage.login(provider.id, callbacks);
	process.stderr.write(`logged in to ${provider.id}\n`);
}

export async function logoutWithPlotAuth(providerId?: string) {
	const authStorage = createPlotAuthStorage();
	const loggedInProviders = authStorage
		.getOAuthProviders()
		.filter((provider: OAuthProviderInterface) => authStorage.has(provider.id));
	if (loggedInProviders.length === 0) {
		throw new CliError("runtime", "no logged-in oauth providers found", 1);
	}
	const provider = await chooseProvider(loggedInProviders, providerId);
	authStorage.logout(provider.id);
	process.stderr.write(`logged out from ${provider.id}\n`);
}

function writeBlock(title: string, lines: ReadonlyArray<string>) {
	const text = [title, ...lines.map((line) => `  ${line}`)].join("\n");
	process.stderr.write(`${text}\n`);
}

export async function loginWithPlotAuthJson(providerId?: string) {
	const authStorage = createPlotAuthStorage();
	const providers = authStorage.getOAuthProviders();

	if (!providerId) {
		writeNdjson("auth:providers", {
			providers: providers.map((p) => ({ id: p.id, name: p.name })),
		});
		return;
	}

	const provider = providers.find((p) => p.id === providerId);
	if (!provider) {
		const { error, fix } = lookupError("PROVIDER_UNKNOWN", `unknown provider: ${providerId}`, { provider: providerId });
		emitError("plot-ai auth login", error, fix, [
			{ command: "plot-ai auth status", description: "check authentication status" },
			{ command: "plot-ai models", description: "list available providers and models" },
		]);
		return;
	}

	const callbacks: OAuthLoginCallbacks = {
		onAuth: ({ url, instructions }: { url: string; instructions?: string }) => {
			writeNdjson("auth:url", { url, instructions });
		},
		onPrompt: async ({
			message,
			placeholder,
			allowEmpty,
		}: {
			message: string;
			placeholder?: string;
			allowEmpty?: boolean;
		}) => {
			writeNdjson("auth:prompt", { message, placeholder, allowEmpty: allowEmpty ?? false });
			const response = await readNdjson();
			if (response.type !== "response" || typeof response["value"] !== "string") {
				throw new CliError("runtime", "invalid response from client", 1);
			}
			if (!allowEmpty && (response["value"] as string).length === 0) {
				throw new CliError("usage", "input cannot be empty", 2);
			}
			return response["value"] as string;
		},
		onManualCodeInput: async () => {
			writeNdjson("auth:prompt", { message: "Paste authorization code", allowEmpty: false });
			const response = await readNdjson();
			if (response.type !== "response" || typeof response["value"] !== "string") {
				throw new CliError("runtime", "invalid response from client", 1);
			}
			return response["value"] as string;
		},
		onProgress: (message: string) => {
			writeNdjson("auth:progress", { message });
		},
	};

	try {
		await authStorage.login(provider.id, callbacks);
		emitResult("plot-ai auth login", { provider: provider.id }, [
			{ command: "plot-ai auth status", description: "check authentication status" },
			{ command: "plot-ai models", description: "list available providers and models" },
			{ command: "plot-ai serve", description: "start the server" },
		]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const { error: envError, fix } = lookupError("AUTH_REQUIRED", message, { provider: provider.id });
		emitError("plot-ai auth login", envError, fix, [
			{ command: "plot-ai auth login " + provider.id, description: "retry authentication" },
			{ command: "plot-ai auth status", description: "check authentication status" },
		]);
	}
}
