import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { createSessionAuth, type SessionAuth } from "@plot/session/auth";
import {
	prepareWorkflow,
	type PrepareWorkflowOptions,
	type PreparedWorkflow,
} from "@plot/session/preparation";
import { openSessionManager } from "@plot/session-manager/ipc";
import type { SessionManagerClient } from "@plot/session-manager/manager";
import type { PlotTuiOptions } from "@plot/tui/plot-tui";
import {
	readPlotDoc,
	readSdkReference,
	renderDocsPaths,
	type DocName,
} from "./docs.js";
import { VERSION } from "./package.js";
import { plotProcessIdentity, resolvePlotCommand } from "./plot-command.js";

export interface CliRuntime {
	readonly cwd: string;
	readonly version: string;
	readonly stdin: AsyncIterable<string | Uint8Array>;
	readonly isInteractive: boolean;
	readonly auth: SessionAuth;
	readonly prepareWorkflow: (
		options: PrepareWorkflowOptions,
	) => Promise<PreparedWorkflow>;
	readonly readDoc: (name: DocName) => Promise<string>;
	readonly readSdkReference: () => Promise<string>;
	readonly renderDocsPaths: () => string;
	readonly writeStdout: (text: string) => Promise<void> | void;
	readonly writeStderr: (text: string) => Promise<void> | void;
	readonly prompt: (message: string) => Promise<string>;
	readonly openBrowser: (url: string) => void;
	readonly getSessionManager: () => Promise<SessionManagerClient>;
	readonly runTui: (options: PlotTuiOptions) => Promise<void> | void;
	readonly startWebGateway: (options: {
		readonly manager: SessionManagerClient;
		readonly host?: string;
		readonly port?: number;
		readonly openUrl: (url: string) => void;
	}) => Promise<{ readonly url: string; readonly stop: () => void }>;
	readonly waitForTermination: (stop: () => void) => Promise<void>;
}

export type CliRuntimeOverrides = Partial<CliRuntime>;

const writeStream = (stream: NodeJS.WritableStream, text: string) =>
	new Promise<void>((resolve, reject) =>
		stream.write(text, (error?: Error | null) => {
			if (error) reject(error);
			else resolve();
		}),
	);

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

const waitForTermination = (stop: () => void): Promise<void> =>
	new Promise<void>((resolve) => {
		const finish = () => {
			process.off("SIGINT", finish);
			process.off("SIGTERM", finish);
			stop();
			resolve();
		};
		process.once("SIGINT", finish);
		process.once("SIGTERM", finish);
	});

export const createProcessCliRuntime = (
	overrides: CliRuntimeOverrides = {},
): CliRuntime => {
	const cwd = overrides.cwd ?? process.cwd();
	const plotCommand = resolvePlotCommand();
	const prompt =
		overrides.prompt ??
		(async (message: string) => {
			const readline = createInterface({
				input: process.stdin,
				output: process.stderr,
			});
			try {
				return await readline.question(`${message} `);
			} finally {
				readline.close();
			}
		});
	let auth: SessionAuth | undefined;
	const writeStdout =
		overrides.writeStdout ??
		((text: string) => writeStream(process.stdout, text));
	const writeStderr =
		overrides.writeStderr ??
		((text: string) => writeStream(process.stderr, text));
	return {
		cwd,
		version: overrides.version ?? VERSION,
		stdin:
			overrides.stdin ?? (process.stdin as AsyncIterable<string | Uint8Array>),
		isInteractive:
			overrides.isInteractive ??
			(process.stdin.isTTY === true && process.stdout.isTTY === true),
		get auth() {
			return overrides.auth ?? (auth ??= createSessionAuth({ cwd }));
		},
		prepareWorkflow:
			overrides.prepareWorkflow ??
			((options) =>
				prepareWorkflow({
					...options,
					diagnostic: ({ stream, text }) => writeStderr(`[${stream}] ${text}`),
				})),
		readDoc: overrides.readDoc ?? readPlotDoc,
		readSdkReference: overrides.readSdkReference ?? readSdkReference,
		renderDocsPaths: overrides.renderDocsPaths ?? renderDocsPaths,
		writeStdout,
		writeStderr,
		prompt,
		openBrowser: overrides.openBrowser ?? openBrowser,
		getSessionManager:
			overrides.getSessionManager ??
			(() =>
				openSessionManager({
					cli: plotCommand,
					identity: plotProcessIdentity(plotCommand),
				})),
		runTui:
			overrides.runTui ??
			(async (options) => {
				const { runPlotTui } = await import("@plot/tui/plot-tui");
				await runPlotTui(options);
			}),
		startWebGateway:
			overrides.startWebGateway ??
			(async (options) => {
				const { startPlotWebGateway } = await import("@plot/gateway");
				return startPlotWebGateway(options);
			}),
		waitForTermination: overrides.waitForTermination ?? waitForTermination,
	};
};
