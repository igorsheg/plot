import { createInterface } from "node:readline/promises";
import type { PlotWebGatewayOptions } from "@plot/gateway";
import { createSessionAuth, type SessionAuth } from "@plot/session/auth";
import { openSessionManager } from "@plot/session-manager/ipc";
import type { SessionManagerClient } from "@plot/session-manager/manager";
import type { PlotTuiOptions } from "@plot/tui/plot-tui";
import { plotProcessIdentity, resolvePlotCommand } from "./plot-command.js";

export interface CliHost {
	readonly cwd: string;
	readonly isInteractive: boolean;
	readonly auth: SessionAuth;
	readonly stdout: (text: string) => void;
	readonly stderr: (text: string) => void;
	readonly prompt: (message: string) => Promise<string>;
	readonly openBrowser: (url: string) => void;
	readonly sessions: () => Promise<SessionManagerClient>;
	readonly runTui: (options: PlotTuiOptions) => Promise<void> | void;
	readonly startWebGateway: (
		options: PlotWebGatewayOptions,
	) => Promise<{ readonly url: string; readonly stop: () => void }>;
	readonly waitForTermination: (stop: () => void) => Promise<void>;
}

const openBrowser = (url: string): void => {
	const [command, ...args] =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["rundll32", "url.dll,FileProtocolHandler", url]
				: ["xdg-open", url];
	try {
		Bun.spawn([command, ...args], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
			detached: true,
		}).unref();
	} catch {
		return;
	}
};

const prompt = async (message: string): Promise<string> => {
	const readline = createInterface({
		input: process.stdin,
		output: process.stderr,
	});
	try {
		return await readline.question(`${message} `);
	} finally {
		readline.close();
	}
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

export const createProcessCliHost = (): CliHost => {
	const cwd = process.cwd();
	let auth: SessionAuth | undefined;
	return {
		cwd,
		isInteractive:
			process.stdin.isTTY === true && process.stdout.isTTY === true,
		get auth() {
			return (auth ??= createSessionAuth({ cwd }));
		},
		stdout: (text) => {
			process.stdout.write(text);
		},
		stderr: (text) => {
			process.stderr.write(text);
		},
		prompt,
		openBrowser,
		sessions: () => {
			const cli = resolvePlotCommand();
			return openSessionManager({
				cli,
				identity: plotProcessIdentity(cli),
			});
		},
		runTui: async (options) => {
			const { runPlotTui } = await import("@plot/tui/plot-tui");
			await runPlotTui(options);
		},
		startWebGateway: async (options) => {
			const { startPlotWebGateway } = await import("@plot/gateway");
			return startPlotWebGateway(options);
		},
		waitForTermination,
	};
};
