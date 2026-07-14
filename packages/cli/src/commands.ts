import { resolve } from "node:path";
import type { AuthProviderInfo } from "@plot/session/auth";
import type { PreparedWorkflow } from "@plot/session/preparation";
import type { CliInvocation } from "./cli-parser.js";
import type { CliRuntime } from "./cli-runtime.js";
import { renderHelp } from "./help.js";
import { renderAuthStatus, renderModels } from "./render.js";

const workflowInput = (
	runtime: CliRuntime,
	workflowPath: string | undefined,
): { cwd: string; workflowPath?: string } => {
	const input: { cwd: string; workflowPath?: string } = { cwd: runtime.cwd };
	if (workflowPath !== undefined) input.workflowPath = workflowPath;
	return input;
};

const renderReadiness = (
	workflowPath: string,
	source: PreparedWorkflow["source"],
): string => {
	const lines = [`OK Workflow ${workflowPath}`, `OK Extension ${source.label}`];
	for (const requirement of source.requirements) {
		if (requirement.status === "ready") continue;
		const prefix =
			requirement.status === "action-required" ? "NEEDS YOU" : "WAIT";
		lines.push(
			`${prefix} ${requirement.label}: ${requirement.message ?? requirement.status}`,
		);
	}
	return `${lines.join("\n")}\n`;
};

const checkWorkflow = async (
	runtime: CliRuntime,
	workflowPath?: string,
): Promise<string> => {
	const prepared = await runtime.prepareWorkflow(
		workflowInput(runtime, workflowPath),
	);
	try {
		return renderReadiness(prepared.workflow.path!, prepared.source);
	} finally {
		await prepared.close();
	}
};

interface SelectPrompt {
	readonly message: string;
	readonly options: readonly { readonly id: string; readonly label: string }[];
}

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
	runtime: CliRuntime,
	prompt: SelectPrompt,
): Promise<string> => {
	await runtime.writeStderr(
		`${[
			prompt.message.replace(/:+$/, ":"),
			...prompt.options.map(
				(option, index) => `  ${index + 1}. ${option.label}`,
			),
		].join("\n")}\n`,
	);
	for (;;) {
		// eslint-disable-next-line no-await-in-loop -- interactive validation is sequential.
		const response = await runtime.prompt("Choose [1]:");
		const selected = selectOptionId(prompt, response);
		if (selected !== undefined) return selected;
		// eslint-disable-next-line no-await-in-loop -- validation precedes the next prompt.
		await runtime.writeStderr("Enter a number from the list.\n");
	}
};

const selectLoginProvider = async (
	runtime: CliRuntime,
	providers: readonly AuthProviderInfo[],
): Promise<string> => {
	if (providers.length === 0)
		throw new Error("No auth providers found. Run `plot models` first.");
	return readSelect(runtime, {
		message: "Choose a provider to log in:",
		options: providers.map((provider) => ({
			id: provider.id,
			label: `${provider.id} - ${provider.name}${provider.configured ? " (configured)" : ""}`,
		})),
	});
};

const selectLogoutProvider = async (
	runtime: CliRuntime,
	providers: readonly AuthProviderInfo[],
): Promise<string> => {
	const configured = providers.filter((provider) => provider.configured);
	if (configured.length === 0)
		throw new Error("No configured auth providers found.");
	return readSelect(runtime, {
		message: "Choose a provider to log out:",
		options: configured.map((provider) => ({
			id: provider.id,
			label: `${provider.id} - ${provider.name}`,
		})),
	});
};

const login = async (
	runtime: CliRuntime,
	providerInput: string | undefined,
): Promise<void> => {
	if (!runtime.isInteractive)
		throw new Error("auth login requires an interactive terminal");
	const provider =
		providerInput ??
		(await selectLoginProvider(runtime, await runtime.auth.providers()));
	let writes = Promise.resolve();
	const write = (text: string) => {
		writes = writes.then(() => runtime.writeStderr(text));
	};
	let failure: unknown;
	try {
		await runtime.auth.login({
			provider,
			events: {
				auth: (info) => {
					runtime.openBrowser(info.url);
					write(
						`Opening browser: ${info.url}\n${info.instructions ?? "If it did not open, copy the URL above."}\n`,
					);
				},
				deviceCode: (info) =>
					write(`Open ${info.verificationUri} and enter ${info.userCode}\n`),
				prompt: (prompt) => write(`${prompt.message}\n`),
				progress: (message) => write(`${message}\n`),
			},
			promptInput: (prompt) => runtime.prompt(prompt.message),
			manualCodeInput: () =>
				runtime.prompt("Paste the authorization code or redirect URL:"),
			selectInput: (prompt) => readSelect(runtime, prompt),
		});
	} catch (error) {
		failure = error;
	}
	try {
		await writes;
	} catch (error) {
		failure ??= error;
	}
	if (failure !== undefined) throw failure;
	await runtime.writeStdout(`Logged in to ${provider}.\n`);
};

const executeAuth = async (
	invocation: Extract<CliInvocation, { kind: "auth" }>,
	runtime: CliRuntime,
): Promise<void> => {
	if (invocation.action === "status") {
		await runtime.writeStdout(renderAuthStatus(await runtime.auth.status()));
		return;
	}
	if (invocation.action === "login") {
		await login(runtime, invocation.provider);
		return;
	}
	if (invocation.provider === undefined && !runtime.isInteractive)
		throw new Error("auth logout requires an interactive terminal or provider");
	const provider =
		invocation.provider ??
		(await selectLogoutProvider(runtime, await runtime.auth.providers()));
	await runtime.auth.logout(provider);
	await runtime.writeStdout(`Logged out from ${provider}.\n`);
};

export const executeCliInvocation = async (
	invocation: CliInvocation,
	runtime: CliRuntime,
): Promise<void> => {
	switch (invocation.kind) {
		case "version":
			await runtime.writeStdout(`${runtime.version}\n`);
			return;
		case "help":
			await runtime.writeStdout(renderHelp(invocation.target, runtime.version));
			return;
		case "attach": {
			const manager = await runtime.getSessionManager();
			const { session } = await manager.start(
				workflowInput(runtime, invocation.workflowPath),
			);
			await runtime.runTui({ manager, session });
			return;
		}
		case "start": {
			const result = await (
				await runtime.getSessionManager()
			).start(workflowInput(runtime, invocation.workflowPath));
			await runtime.writeStdout(
				`${result.started ? "Started" : "Already running"} ${result.session.workflowName}\n`,
			);
			return;
		}
		case "stop": {
			const path = resolve(
				runtime.cwd,
				invocation.workflowPath ?? "WORKFLOW.md",
			);
			const session = await (await runtime.getSessionManager()).stop(path);
			await runtime.writeStdout(
				session === undefined
					? `${path} is not running\n`
					: `Stopped ${session.workflowName}\n`,
			);
			return;
		}
		case "check":
			await runtime.writeStdout(
				await checkWorkflow(runtime, invocation.workflowPath),
			);
			return;
		case "web": {
			const options: {
				manager: Awaited<ReturnType<CliRuntime["getSessionManager"]>>;
				openUrl: (url: string) => void;
				host?: string;
				port?: number;
			} = {
				manager: await runtime.getSessionManager(),
				openUrl: runtime.openBrowser,
			};
			if (invocation.host !== undefined) options.host = invocation.host;
			if (invocation.port !== undefined) options.port = invocation.port;
			const gateway = await runtime.startWebGateway(options);
			await runtime.writeStdout(`Plot Web Console: ${gateway.url}\n`);
			await runtime.waitForTermination(gateway.stop);
			return;
		}
		case "docs":
			if (invocation.paths) {
				await runtime.writeStdout(runtime.renderDocsPaths());
				return;
			}
			if (invocation.topic === "sdk") {
				await runtime.writeStdout(await runtime.readSdkReference());
				return;
			}
			await runtime.writeStdout(
				await runtime.readDoc(invocation.topic ?? "index"),
			);
			return;
		case "auth":
			await executeAuth(invocation, runtime);
			return;
		case "models":
			await runtime.writeStdout(
				renderModels(
					invocation.search,
					await runtime.auth.listModels(invocation.search),
				),
			);
	}
};
