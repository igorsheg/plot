import { type Subprocess } from "bun";
import path from "node:path";
import type { ProjectStatus } from "../shared/types";

type ProcessEntry = {
	pid: number;
	status: ProjectStatus;
	process: Subprocess;
	error?: string;
};

type StatusChangeCallback = (
	projectPath: string,
	status: ProjectStatus,
	error?: string,
) => void;
type LogCallback = (projectPath: string, line: string) => void;
type ExitCallback = (projectPath: string, code: number | null) => void;

export class ProcessManager {
	private processes = new Map<string, ProcessEntry>();
	private statusChangeCallbacks: StatusChangeCallback[] = [];
	private logCallbacks: LogCallback[] = [];
	private exitCallbacks: ExitCallback[] = [];

	onStatusChange(callback: StatusChangeCallback): void {
		this.statusChangeCallbacks.push(callback);
	}

	onLog(callback: LogCallback): void {
		this.logCallbacks.push(callback);
	}

	onExit(callback: ExitCallback): void {
		this.exitCallbacks.push(callback);
	}

	getStatus(projectPath: string): ProjectStatus {
		return this.processes.get(projectPath)?.status ?? "idle";
	}

	getAll(): Map<string, { pid: number; status: ProjectStatus; process: Subprocess }> {
		return new Map(
			[...this.processes.entries()].map(([k, v]) => [
				k,
				{ pid: v.pid, status: v.status, process: v.process },
			]),
		);
	}

	async start(projectPath: string, workflowPath: string): Promise<number> {
		const existing = this.processes.get(projectPath);
		if (existing && (existing.status === "running" || existing.status === "starting")) {
			return existing.pid;
		}

		const bin = await this.resolveBinary(projectPath);
		const args =
			bin === "npx"
				? ["npx", "plot-ai", "serve", "--json", "--workflow", workflowPath]
				: [bin, "serve", "--json", "--workflow", workflowPath];

		let proc: Subprocess;
		try {
			proc = Bun.spawn(args, {
				cwd: projectPath,
				stdout: "pipe",
				stderr: "pipe",
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.setEntry(projectPath, {
				pid: -1,
				status: "error",
				process: null as unknown as Subprocess,
				error: msg,
			});
			throw err;
		}

		const entry: ProcessEntry = {
			pid: proc.pid,
			status: "starting",
			process: proc,
		};
		this.setEntry(projectPath, entry);

		this.readStdout(projectPath, proc);
		this.readStderr(projectPath, proc);
		this.watchExit(projectPath, proc);

		return proc.pid;
	}

	async stop(projectPath: string): Promise<void> {
		const entry = this.processes.get(projectPath);
		if (!entry || entry.status === "stopped" || entry.status === "idle") return;

		entry.process.kill("SIGTERM");

		const exited = await Promise.race([
			entry.process.exited.then(() => true),
			new Promise<false>((r) => setTimeout(() => r(false), 5000)),
		]);

		if (!exited) {
			entry.process.kill("SIGKILL");
			await entry.process.exited;
		}
	}

	private async resolveBinary(projectPath: string): Promise<string> {
		const localBin = path.join(projectPath, "node_modules/.bin/plot-ai");
		try {
			await Bun.file(localBin).exists().then((exists) => {
				if (!exists) throw new Error("not found");
			});
			return localBin;
		} catch {
			// fall through
		}

		const which = Bun.spawnSync(["which", "plot-ai"]);
		if (which.exitCode === 0) return "plot-ai";

		return "npx";
	}

	private async readStdout(projectPath: string, proc: Subprocess): Promise<void> {
		const reader = proc.stdout as ReadableStream<Uint8Array>;
		if (!reader) return;

		const decoder = new TextDecoder();
		let buf = "";
		let first = true;

		for await (const chunk of reader) {
			buf += decoder.decode(chunk, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";

			for (const line of lines) {
				if (!line) continue;
				if (first) {
					first = false;
					this.updateStatus(projectPath, "running");
				}
				for (const cb of this.logCallbacks) cb(projectPath, line);
			}
		}

		if (buf) {
			if (first) this.updateStatus(projectPath, "running");
			for (const cb of this.logCallbacks) cb(projectPath, buf);
		}
	}

	private async readStderr(projectPath: string, proc: Subprocess): Promise<void> {
		const reader = proc.stderr as ReadableStream<Uint8Array>;
		if (!reader) return;

		const decoder = new TextDecoder();
		let buf = "";

		for await (const chunk of reader) {
			buf += decoder.decode(chunk, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";

			for (const line of lines) {
				if (!line) continue;
				for (const cb of this.logCallbacks) cb(projectPath, line);
			}
		}

		if (buf) {
			for (const cb of this.logCallbacks) cb(projectPath, buf);
		}
	}

	private async watchExit(projectPath: string, proc: Subprocess): Promise<void> {
		const code = await proc.exited;
		const status: ProjectStatus = code === 0 || code === null ? "stopped" : "error";
		const entry = this.processes.get(projectPath);
		if (entry) {
			entry.status = status;
			if (status === "error") entry.error = `Process exited with code ${code}`;
		}
		for (const cb of this.statusChangeCallbacks) {
			cb(projectPath, status, entry?.error);
		}
		for (const cb of this.exitCallbacks) cb(projectPath, code);
	}

	private setEntry(projectPath: string, entry: ProcessEntry): void {
		this.processes.set(projectPath, entry);
		for (const cb of this.statusChangeCallbacks) {
			cb(projectPath, entry.status, entry.error);
		}
	}

	private updateStatus(projectPath: string, status: ProjectStatus, error?: string): void {
		const entry = this.processes.get(projectPath);
		if (!entry) return;
		entry.status = status;
		if (error) entry.error = error;
		for (const cb of this.statusChangeCallbacks) cb(projectPath, status, error);
	}
}
