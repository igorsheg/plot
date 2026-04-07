import { spawn } from "bun";
import { dirname, resolve } from "node:path";
import type {
	AgentRuntimeEvent,
	RuntimeSnapshot,
	JsonRpcNotification,
} from "@plot/sdk";
import type { RuntimeApi } from "@plot/tui";
import type { ServerOptions } from "./options.js";
import {
	resolveSelfCommandArgs,
	resolveTuiServerLogPath,
	toTuiServerEnv,
} from "./runtime.js";

type SseStatus = "connected" | "connecting" | "reconnecting" | "disconnected";

export interface TuiRuntimeHandle {
	api: RuntimeApi;
	close: () => void;
	logPath: string;
}

function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
	return (
		typeof msg === "object" &&
		msg !== null &&
		"jsonrpc" in msg &&
		(msg as Record<string, unknown>)["jsonrpc"] === "2.0" &&
		"method" in msg
	);
}

export async function createTuiRuntimeHandle(
	serverOptions: ServerOptions,
): Promise<TuiRuntimeHandle> {
	const logPath = resolveTuiServerLogPath();
	let status: SseStatus = "connecting";
	let onSnapshot: ((snapshot: RuntimeSnapshot) => void) | null = null;
	let onStatus: ((status: SseStatus) => void) | null = null;
	let onEvent: ((event: AgentRuntimeEvent) => void) | null = null;

	const setStatus = (next: SseStatus) => {
		status = next;
		onStatus?.(next);
	};

	const cmdArgs = [...resolveSelfCommandArgs("--mode"), "rpc"];
	const env = toTuiServerEnv(serverOptions);

	// Resolve the project directory from the workflow path and use it as the
	// subprocess cwd. This makes relative paths in WORKFLOW.md (workspace.root,
	// hooks) behave predictably regardless of where the user invoked plot-ai
	// from. Plot also resolves paths internally against projectDir — this is
	// the outer defense.
	const projectDir = dirname(resolve(serverOptions.workflow));

	const proc = spawn(cmdArgs, {
		stdio: ["pipe", "pipe", "pipe"],
		env,
		cwd: projectDir,
	});

	drainStream(proc.stderr);

	const ready = new Promise<void>((resolve, reject) => {
		let resolved = false;
		const timeout = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				reject(new Error("RPC subprocess did not become ready within 30s"));
			}
		}, 30_000);

		readNdjsonLines(
			proc.stdout,
			(msg) => {
				if (!isJsonRpcNotification(msg)) return;

				switch (msg.method) {
					case "state/update": {
						const params = msg.params as { snapshot: RuntimeSnapshot };
						if (!resolved) {
							resolved = true;
							clearTimeout(timeout);
							setStatus("connected");
							resolve();
						}
						onSnapshot?.(params.snapshot);
						break;
					}
					case "issue/event": {
						const params = msg.params as {
							issueId: string;
							event: AgentRuntimeEvent;
						};
						onEvent?.(params.event);
						break;
					}
				}
			},
			() => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timeout);
					reject(new Error("RPC subprocess exited before ready"));
				}
				setStatus("disconnected");
			},
		);
	});

	void proc.exited.then(() => {
		setStatus("disconnected");
	});

	setStatus("connecting");
	await ready;

	const sendRequest = (method: string, params: Record<string, unknown> = {}, id: number = 1) => {
		try {
			proc.stdin.write(
				JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n",
			);
		} catch {
			// stdin may already be closed
		}
	};

	const close = () => {
		setStatus("disconnected");
		sendRequest("stop", {}, 1);
		try { proc.stdin.end(); } catch { /* already closed */ }
		if (!proc.killed) proc.kill();
	};

	return {
		api: {
			connectSnapshots: (handleSnapshot, handleStatus) => {
				onSnapshot = handleSnapshot;
				onStatus = handleStatus;
				handleStatus(status);
				return () => {
					onSnapshot = null;
					onStatus = null;
				};
			},
			connectEvents: (handleEvent) => {
				onEvent = handleEvent;
				return () => {
					onEvent = null;
				};
			},
		} as RuntimeApi,
		close,
		logPath,
	};
}

async function readNdjsonLines(
	stream: ReadableStream<Uint8Array>,
	onMessage: (msg: unknown) => void,
	onEnd: () => void,
) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					onMessage(JSON.parse(line));
				} catch {
					/* skip malformed */
				}
			}
		}
		if (buffer.trim()) {
			try {
				onMessage(JSON.parse(buffer));
			} catch {
				/* skip */
			}
		}
	} catch {
		/* stream read error */
	}
	onEnd();
}

function drainStream(stream: ReadableStream<Uint8Array>) {
	stream.pipeTo(new WritableStream()).catch(() => undefined);
}
