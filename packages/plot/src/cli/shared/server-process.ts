import { spawn } from "bun";
import type { Subprocess } from "bun";
import type { ServerOptions } from "./options.js";
import { resolveSelfCommandArgs, toServerEnv } from "./runtime.js";

export interface ServerHandle {
	url: string;
	pid: number;
	stop: () => void;
}

export function startServer(opts: ServerOptions): ServerHandle {
	const server = spawn(resolveSelfCommandArgs("__internal-server"), {
		stdio: ["ignore", "pipe", "pipe"],
		env: toServerEnv(opts),
	});

	pipeOutput(server.stdout);
	pipeOutput(server.stderr);

	void server.exited.then((exitCode) => {
		if (exitCode !== 0 && !server.killed) {
			process.stderr.write(`server exited with code ${exitCode}\n`);
		}
		return undefined;
	});

	const url = `http://localhost:${opts.port}`;

	return {
		url,
		pid: server.pid,
		stop: () => {
			stopServer(server);
		},
	};
}

function stopServer(server: Subprocess) {
	if (server.killed) return;
	server.kill();
}

function pipeOutput(stream: ReadableStream<Uint8Array> | null) {
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
