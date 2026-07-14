import { createWriteStream } from "node:fs";
import type { Writable } from "node:stream";
import { serveSessionWorker } from "@plot/session/worker";

export interface InternalSessionWorkerInput {
	readonly cwd: string;
	readonly sessionId: string;
	readonly workflowPath: string;
}

export const isBrokenPipeError = (error: unknown): boolean => {
	if (error === null || typeof error !== "object") return false;
	const record = error as NodeJS.ErrnoException;
	return record.code === "EPIPE" && record.syscall === "write";
};

export interface WorkerProtocolWriter {
	readonly writeLine: (line: string) => Promise<void>;
	readonly close: () => Promise<void>;
}

export const createWorkerProtocolWriter = (
	protocol: Writable,
): WorkerProtocolWriter => {
	let streamError: Error | undefined;
	protocol.on("error", (error) => {
		streamError = error;
	});
	return {
		writeLine: (line) =>
			new Promise<void>((resolve, reject) => {
				if (streamError !== undefined) {
					reject(streamError);
					return;
				}
				protocol.write(line, (error) => {
					const failure = error ?? streamError;
					if (failure) reject(failure);
					else resolve();
				});
			}),
		close: () =>
			new Promise<void>((resolve) => {
				if (
					streamError !== undefined ||
					protocol.destroyed ||
					protocol.closed
				) {
					resolve();
					return;
				}
				protocol.end(() => resolve());
			}),
	};
};

export const runInternalSessionWorker = async (
	input: InternalSessionWorkerInput,
): Promise<void> => {
	const protocol = createWorkerProtocolWriter(
		createWriteStream("plot-worker-protocol", {
			fd: 3,
			autoClose: false,
		}),
	);
	try {
		await serveSessionWorker({
			cwd: input.cwd,
			sessionId: input.sessionId,
			workflowPath: input.workflowPath,
			stdin: process.stdin,
			writeLine: protocol.writeLine,
		});
	} finally {
		await protocol.close();
	}
};
