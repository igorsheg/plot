import { resolve } from "node:path";
import type { AuthProviderInfo } from "@plot/session/auth";
import {
	prepareWorkflow,
	type CheckedWorkflow,
} from "@plot/session/preparation";
import type { CliHost } from "./cli-host.js";
import type { CliInvocation } from "./cli-parser.js";
import { readDoc, readSdkReference, renderDocsPaths } from "./docs.js";
import { renderHelp } from "./help.js";
import { VERSION } from "./package.js";
import { renderAuthStatus, renderModels } from "./render.js";

const workflowInput = (
	host: CliHost,
	workflowPath: string | undefined,
): { cwd: string; workflowPath?: string } => {
	const input: { cwd: string; workflowPath?: string } = { cwd: host.cwd };
	if (workflowPath !== undefined) input.workflowPath = workflowPath;
	return input;
};

const renderReadiness = (
	workflowPath: string,
	source: CheckedWorkflow["source"],
): string => {
	const lines = [`OK Workflow ${workflowPath}`, `OK Extension ${source.label}`];
	for (const requirement of source.requirements) {
		if (requirement.status === "ready") continue;
		const prefix =
			requirement.status === "action-required" ? "NEEDS YOU" : "WAIT";
		const message =
			"message" in requirement ? requirement.message : requirement.status;
		lines.push(`${prefix} ${requirement.label}: ${message}`);
	}
	return `${lines.join("\n")}\n`;
};

interface SelectPrompt {
	readonly message: string;
	readonly options: readonly { readonly id: string; readonly label: string }[];
}

const selectOptionId = (
	prompt: SelectPrompt,
	input: string,
): string | undefined => {
	const value = input.trim();
	if (value.length === 0) return prompt.options[0]?.id;
	const numbered = Number(value);
	if (Number.isInteger(numbered) && numbered >= 1)
		return prompt.options[numbered - 1]?.id;
	const normalized = value.toLowerCase();
	const label = normalized.replace(/\s*\([^)]*\)\s*$/, "").trim();
	return prompt.options.find(
		(option) =>
			option.id.toLowerCase() === normalized ||
			option.label.toLowerCase() === normalized ||
			option.label
				.toLowerCase()
				.replace(/\s*\([^)]*\)\s*$/, "")
				.trim() === label,
	)?.id;
};

const readSelect = async (
	host: CliHost,
	prompt: SelectPrompt,
): Promise<string> => {
	host.stderr(
		`${[
			prompt.message.replace(/:+$/, ":"),
			...prompt.options.map(
				(option, index) => `  ${index + 1}. ${option.label}`,
			),
		].join("\n")}\n`,
	);
	for (;;) {
		// eslint-disable-next-line no-await-in-loop -- interactive validation is sequential.
		const selected = selectOptionId(prompt, await host.prompt("Choose [1]:"));
		if (selected !== undefined) return selected;
		host.stderr("Enter a number from the list.\n");
	}
};

const selectProvider = async (
	host: CliHost,
	providers: readonly AuthProviderInfo[],
	action: "login" | "logout",
): Promise<string> => {
	const available =
		action === "login"
			? providers
			: providers.filter((provider) => provider.configured);
	if (available.length === 0)
		throw new Error(
			action === "login"
				? "No auth providers found. Run `plot models` first."
				: "No configured auth providers found.",
		);
	return readSelect(host, {
		message: `Choose a provider to log ${action === "login" ? "in" : "out"}:`,
		options: available.map((provider) => ({
			id: provider.id,
			label: `${provider.id} - ${provider.name}${action === "login" && provider.configured ? " (configured)" : ""}`,
		})),
	});
};

const login = async (
	host: CliHost,
	providerInput: string | undefined,
): Promise<void> => {
	if (!host.isInteractive)
		throw new Error("auth login requires an interactive terminal");
	const provider =
		providerInput ??
		(await selectProvider(host, await host.auth.providers(), "login"));
	await host.auth.login({
		provider,
		events: {
			auth: (info) => {
				host.openBrowser(info.url);
				host.stderr(
					`Opening browser: ${info.url}\n${info.instructions ?? "If it did not open, copy the URL above."}\n`,
				);
			},
			deviceCode: (info) =>
				host.stderr(
					`Open ${info.verificationUri} and enter ${info.userCode}\n`,
				),
			prompt: (prompt) => host.stderr(`${prompt.message}\n`),
			progress: (message) => host.stderr(`${message}\n`),
		},
		promptInput: (prompt) => host.prompt(prompt.message),
		manualCodeInput: () =>
			host.prompt("Paste the authorization code or redirect URL:"),
		selectInput: (prompt) => readSelect(host, prompt),
	});
	host.stdout(`Logged in to ${provider}.\n`);
};

const executeAuth = async (
	invocation: Extract<CliInvocation, { kind: "auth" }>,
	host: CliHost,
): Promise<void> => {
	if (invocation.action === "status") {
		host.stdout(renderAuthStatus(await host.auth.status()));
		return;
	}
	if (invocation.action === "login") return login(host, invocation.provider);
	if (invocation.provider === undefined && !host.isInteractive)
		throw new Error("auth logout requires an interactive terminal or provider");
	const provider =
		invocation.provider ??
		(await selectProvider(host, await host.auth.providers(), "logout"));
	await host.auth.logout(provider);
	host.stdout(`Logged out from ${provider}.\n`);
};

export const executeCliInvocation = async (
	invocation: CliInvocation,
	host: CliHost,
): Promise<void> => {
	switch (invocation.kind) {
		case "version":
			host.stdout(`${VERSION}\n`);
			return;
		case "help":
			host.stdout(renderHelp(invocation.target, VERSION));
			return;
		case "attach": {
			const manager = await host.sessions();
			const { session } = await manager.start(
				workflowInput(host, invocation.workflowPath),
			);
			await host.runTui({ manager, session });
			return;
		}
		case "start": {
			const result = await (
				await host.sessions()
			).start(workflowInput(host, invocation.workflowPath));
			host.stdout(
				`${result.started ? "Started" : "Already running"} ${result.session.workflowName}\n`,
			);
			return;
		}
		case "stop": {
			const path = resolve(host.cwd, invocation.workflowPath ?? "WORKFLOW.md");
			const session = await (await host.sessions()).stop(path);
			host.stdout(
				session === undefined
					? `${path} is not running\n`
					: `Stopped ${session.workflowName}\n`,
			);
			return;
		}
		case "check": {
			const prepared = await prepareWorkflow(
				workflowInput(host, invocation.workflowPath),
			);
			host.stdout(renderReadiness(prepared.workflowPath, prepared.source));
			return;
		}
		case "web": {
			const options: {
				manager: Awaited<ReturnType<CliHost["sessions"]>>;
				openUrl: (url: string) => void;
				host?: string;
				port?: number;
			} = {
				manager: await host.sessions(),
				openUrl: host.openBrowser,
			};
			if (invocation.host !== undefined) options.host = invocation.host;
			if (invocation.port !== undefined) options.port = invocation.port;
			const gateway = await host.startWebGateway(options);
			host.stdout(`Plot Web Console: ${gateway.url}\n`);
			await host.waitForTermination(gateway.stop);
			return;
		}
		case "docs":
			host.stdout(
				invocation.paths
					? renderDocsPaths()
					: await (invocation.topic === "sdk"
							? readSdkReference()
							: readDoc(invocation.topic ?? "index")),
			);
			return;
		case "auth":
			await executeAuth(invocation, host);
			return;
		case "models":
			host.stdout(
				renderModels(
					invocation.search,
					await host.auth.listModels(invocation.search),
				),
			);
	}
};
