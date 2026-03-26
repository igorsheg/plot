import { spawn } from "bun";
import type { ServerOptions } from "./options.js";
import { resolveSelfCommandArgs, toServerEnv } from "./runtime.js";

export interface ServerHandle {
	url: string;
	pid: number;
	stop: () => void;
}

/**
 * Spawn the engine subprocess.
 *
 * - Engine stdout (NDJSON) is silenced — only the parent CLI emits NDJSON.
 * - Engine stderr (Effect logs) is forwarded to parent stderr only when verbose.
 * - Engine runs in its own process group so parent ctrl-c doesn't hit it directly.
 *   Parent calls handle.stop() to terminate it cleanly.
 */
export function startServer(opts: ServerOptions): ServerHandle {
	const server = spawn(resolveSelfCommandArgs("__internal-server"), {
		stdio: ["ignore", "pipe", "pipe"],
		env: toServerEnv(opts),
	});

	if (opts.verbose) {
		pipeToStderr(server.stdout);
		pipeToStderr(server.stderr);
	} else {
		drainStream(server.stdout);
		drainStream(server.stderr);
	}

	void server.exited.then((exitCode) => {
		if (exitCode !== 0 && !server.killed) {
			process.stderr.write(`engine exited with code ${exitCode}\n`);
		}
		return undefined;
	});

	const url = `http://localhost:${opts.port}`;

	return {
		url,
		pid: server.pid,
		stop: () => {
			if (!server.killed) server.kill();
		},
	};
}

function pipeToStderr(stream: ReadableStream<Uint8Array> | null) {
	if (!stream) return;
	stream
		.pipeTo(
			new WritableStream({
				write(chunk) {
					process.stderr.write(chunk);
				},
			}),
		)
		.catch(() => undefined);
}

function drainStream(stream: ReadableStream<Uint8Array> | null) {
	if (!stream) return;
	stream.pipeTo(new WritableStream()).catch(() => undefined);
}

export async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;

	const wait = () =>
		new Promise<void>((resolve) => {
			setTimeout(resolve, 200);
		});

	const poll = async (): Promise<void> => {
		if (Date.now() >= deadline) {
			throw new Error(`server did not start within ${timeoutMs}ms`);
		}

		try {
			const res = await fetch(`${url}/health`);
			if (res.ok) return;
		} catch {
			// server not ready yet
		}

		await wait();
		return poll();
	};

	return poll();
}
