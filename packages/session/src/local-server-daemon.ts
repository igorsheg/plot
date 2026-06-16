import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureLocalControlToken } from "./local-server-auth.js";
import {
	discoverHealthyLocalPlotServer,
	readLocalPlotServerMetadata,
	removeLocalPlotServerMetadata,
	type LocalPlotServerMetadata,
} from "./local-server-metadata.js";
import {
	resolveLocalPlotServerPaths,
	type LocalPlotServerPathOptions,
	type LocalPlotServerPaths,
} from "./local-server-paths.js";

export interface LocalPlotServerDaemonOptions extends LocalPlotServerPathOptions {
	readonly cwd?: string;
	readonly startTimeoutMs?: number;
}

export interface StopLocalPlotServerDaemonOptions extends LocalPlotServerPathOptions {
	readonly timeoutMs?: number;
}

const isProcessRunning = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const signalProcess = (pid: number, signal: NodeJS.Signals): void => {
	try {
		process.kill(pid, signal);
	} catch {
		// The process may already have exited; stop is idempotent.
	}
};

const currentPlotServeCommand = (): { command: string; args: string[] } => {
	const override = process.env["PLOT_LOCAL_SERVER_COMMAND"];
	if (override !== undefined && override.trim() !== "") {
		const [command, ...args] = override.trim().split(/\s+/);
		if (command !== undefined) return { command, args };
	}
	const entrypoint = process.argv[1];
	const exec = process.execPath;
	if (entrypoint !== undefined && entrypoint !== exec)
		return { command: exec, args: [entrypoint, "_serve"] };
	return { command: exec, args: ["_serve"] };
};

export const spawnLocalPlotServerDaemon = (cwd: string | undefined): void => {
	const { command, args } = currentPlotServeCommand();
	const child = spawn(command, args, {
		cwd,
		detached: true,
		stdio: "ignore",
		env: process.env,
	});
	child.unref();
};

export const statusLocalPlotServerDaemon = async (
	options: LocalPlotServerPathOptions = {},
): Promise<LocalPlotServerMetadata | undefined> => {
	const paths = resolveLocalPlotServerPaths(options);
	const token = await ensureLocalControlToken(paths);
	return discoverHealthyLocalPlotServer({
		paths,
		token: token.token,
		tokenFingerprint: token.fingerprint,
	});
};

const waitForLocalPlotServer = async (input: {
	readonly paths: LocalPlotServerPaths;
	readonly timeoutMs: number;
}): Promise<LocalPlotServerMetadata | undefined> => {
	const token = await ensureLocalControlToken(input.paths);
	const deadline = Date.now() + input.timeoutMs;
	while (Date.now() <= deadline) {
		const metadata = await discoverHealthyLocalPlotServer({
			paths: input.paths,
			token: token.token,
			tokenFingerprint: token.fingerprint,
		});
		if (metadata !== undefined) return metadata;
		await sleep(100);
	}
	return undefined;
};

const awaitProcessStopped = async (
	pid: number,
	timeoutMs: number,
): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		if (!isProcessRunning(pid)) return true;
		await sleep(50);
	}
	return !isProcessRunning(pid);
};

export const stopLocalPlotServerDaemon = async (
	options: StopLocalPlotServerDaemonOptions = {},
): Promise<boolean> => {
	const paths = resolveLocalPlotServerPaths(options);
	const healthy = await statusLocalPlotServerDaemon(options);
	if (healthy === undefined) {
		await removeLocalPlotServerMetadata(paths).catch(() => undefined);
		return false;
	}

	// Only signal another authenticated registered process. Test/SDK foreground
	// servers can share this process; daemon-stop must never SIGTERM itself.
	if (healthy.pid === process.pid) return false;

	// A stale metadata PID may have been reused by another process; healthcheck
	// auth is the guardrail.
	signalProcess(healthy.pid, "SIGTERM");
	if (await awaitProcessStopped(healthy.pid, options.timeoutMs ?? 5_000)) {
		await removeLocalPlotServerMetadata(paths).catch(() => undefined);
		return true;
	}

	const latest = await statusLocalPlotServerDaemon(options);
	if (latest === undefined || latest.id !== healthy.id) {
		await removeLocalPlotServerMetadata(paths).catch(() => undefined);
		return false;
	}
	signalProcess(healthy.pid, "SIGKILL");
	const stopped = await awaitProcessStopped(
		healthy.pid,
		options.timeoutMs ?? 5_000,
	);
	await removeLocalPlotServerMetadata(paths).catch(() => undefined);
	return stopped;
};

export const startLocalPlotServerDaemon = async (
	options: LocalPlotServerDaemonOptions = {},
): Promise<LocalPlotServerMetadata> => {
	const paths = resolveLocalPlotServerPaths(options);
	const existing = await statusLocalPlotServerDaemon(options);
	if (existing !== undefined) return existing;

	const registered = await readLocalPlotServerMetadata(paths);
	if (registered !== undefined) await stopLocalPlotServerDaemon(options);

	spawnLocalPlotServerDaemon(options.cwd);
	const started = await waitForLocalPlotServer({
		paths,
		timeoutMs: options.startTimeoutMs ?? 5_000,
	});
	if (started === undefined)
		throw new Error("Failed to start Local Plot Server");
	return started;
};
