import { execFileAsync } from "../../lib/exec.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createConnection } from "node:net";


function walkUp(startDir: string, filename: string, globalFallback = false): string | null {
	let dir = startDir;
	while (true) {
		const candidate = join(dir, ".beads", filename);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	if (globalFallback) {
		const globalPath = join(homedir(), ".beads", filename);
		if (existsSync(globalPath)) return globalPath;
	}
	return null;
}

function findSocketPath(workspaceRoot: string): string | null {
	return walkUp(workspaceRoot, "bd.sock", true);
}

function findBeadsDirectory(workspaceRoot: string): string | null {
	let dir = workspaceRoot;
	while (true) {
		const candidate = join(dir, ".beads");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

interface DaemonResponse {
	success: boolean;
	data?: unknown;
	error?: string;
}

export class BeadsDaemonTransport {
	private socketPath: string | null = null;

	constructor(
		private readonly workspaceRoot: string,
		private readonly requestTimeoutMs = 5_000,
		private readonly actor = "plot",
	) {}

	async listAllIssues<T>(): Promise<T> {
		return this.send<T>("list", { status: "all" });
	}


	async viewIssue<T>(id: string): Promise<T> {
		return this.send<T>("show", { id });
	}

	private async send<T>(operation: string, args: Record<string, unknown>): Promise<T> {
		const socketPath = await this.ensureRunning();
		return await new Promise<T>((resolve, reject) => {
			const socket = createConnection(socketPath);
			let responseData = "";
			let settled = false;

			const settle = (fn: (value: T | Error) => void, value: T | Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				fn(value);
			};

			const handleResponse = (raw: string) => {
				const trimmed = raw.trim();
				if (!trimmed) {
					settle(
						reject as (value: T | Error) => void,
						new Error("beads daemon returned empty response"),
					);
					return;
				}
				try {
					const response = JSON.parse(trimmed) as DaemonResponse;
					if (response.success) {
						settle(resolve as (value: T | Error) => void, response.data as T);
						return;
					}
					settle(
						reject as (value: T | Error) => void,
						new Error(response.error ?? "unknown beads daemon error"),
					);
				} catch {
					settle(
						reject as (value: T | Error) => void,
						new Error(`failed to parse beads daemon response: ${trimmed}`),
					);
				}
			};

			const timeout = setTimeout(() => {
				socket.destroy();
				settle(
					reject as (value: T | Error) => void,
					new Error(`beads daemon request timed out after ${this.requestTimeoutMs}ms`),
				);
			}, this.requestTimeoutMs);

			socket.on("connect", () => {
				socket.write(
					JSON.stringify({
						operation,
						args,
						cwd: this.workspaceRoot,
						actor: this.actor,
					}) + "\n",
				);
			});

			socket.on("data", (chunk: Buffer) => {
				responseData += chunk.toString();
				if (responseData.includes("\n")) {
					socket.destroy();
					handleResponse(responseData);
				}
			});

			socket.on("end", () => {
				if (!settled && responseData.length > 0) {
					handleResponse(responseData);
					return;
				}
				if (!settled) {
					settle(
						reject as (value: T | Error) => void,
						new Error("beads daemon closed connection without a response"),
					);
				}
			});

			socket.on("error", (error: Error) => {
				this.socketPath = null;
				settle(
					reject as (value: T | Error) => void,
					new Error(`beads daemon connection error: ${error.message}`),
				);
			});
		});
	}

	private async ensureRunning(): Promise<string> {
		if (this.socketPath) return this.socketPath;
		const found = findSocketPath(this.workspaceRoot);
		if (found) {
			this.socketPath = found;
			return found;
		}
		await this.startDaemon();
		if (!this.socketPath) throw new Error("beads daemon socket unavailable");
		return this.socketPath;
	}

	private async startDaemon(): Promise<void> {
		const beadsDirectory = findBeadsDirectory(this.workspaceRoot);
		if (!beadsDirectory) {
			throw new Error("no .beads directory found");
		}
		await execFileAsync("bd", ["daemon", "start"], {
			cwd: this.workspaceRoot,
			maxBuffer: 50 * 1024 * 1024,
		});
		const expectedSocketPath = join(beadsDirectory, "bd.sock");
		await new Promise<void>((resolve, reject) => {
			const startedAt = Date.now();
			const timer = setInterval(() => {
				if (existsSync(expectedSocketPath)) {
					clearInterval(timer);
					this.socketPath = expectedSocketPath;
					resolve();
					return;
				}
				if (Date.now() - startedAt >= this.requestTimeoutMs) {
					clearInterval(timer);
					reject(new Error(`beads daemon socket did not appear within ${this.requestTimeoutMs}ms`));
				}
			}, 100);
		});
	}
}

export async function tryCreateBeadsDaemonTransport(
	workspaceRoot: string,
): Promise<BeadsDaemonTransport | null> {
	const transport = new BeadsDaemonTransport(workspaceRoot);
	try {
		await transport.listAllIssues<unknown>();
		return transport;
	} catch {
		return null;
	}
}
