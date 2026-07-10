import { jsonlLines } from "@plot/common/jsonl";
import {
	createProtocolSessionHost,
	type CreateSessionHostOptions,
} from "./host.js";
import {
	decodeClientRequestLine,
	encodeServerRecordLine,
	makeError,
	toProtocolBoundaryError,
} from "./protocol.js";
import type { RuntimeEvent } from "./runtime.js";

export interface RunSessionOnceOptions extends CreateSessionHostOptions {
	readonly onEvent?: (event: RuntimeEvent) => Promise<void> | void;
}

export interface ServeSessionStdioOptions extends CreateSessionHostOptions {
	readonly stdin: AsyncIterable<string | Uint8Array>;
	readonly writeLine: (line: string) => Promise<void> | void;
}

export const runSessionOnce = async (
	options: RunSessionOnceOptions,
): Promise<void> => {
	const host = await createProtocolSessionHost(options);
	const controller = new AbortController();
	const events = options.onEvent
		? (async () => {
				for await (const event of host.runtime.events(controller.signal))
					await options.onEvent?.(event);
			})()
		: Promise.resolve();
	try {
		await host.runtime.runOnce();
	} finally {
		try {
			await host.shutdown();
		} finally {
			controller.abort();
			await events;
		}
	}
};

export const serveSessionStdio = async (
	options: ServeSessionStdioOptions,
): Promise<void> => {
	const host = await createProtocolSessionHost(options);
	let writes = Promise.resolve();
	const write = (line: string): Promise<void> => {
		writes = writes.then(() => options.writeLine(line));
		return writes;
	};
	const writeError = (error: unknown): Promise<void> => {
		const boundary = toProtocolBoundaryError(error);
		return write(
			encodeServerRecordLine(
				makeError({
					code: boundary.code,
					message: boundary.message,
					details: boundary.details,
				}),
				host.limits,
			),
		);
	};
	const output = (async () => {
		for await (const record of host.protocol.output())
			await write(encodeServerRecordLine(record, host.limits));
	})();

	try {
		await write(
			encodeServerRecordLine(await host.protocol.welcome(), host.limits),
		);
		try {
			for await (const line of jsonlLines(options.stdin, {
				maxLineBytes: host.limits.maxInputLineBytes,
			})) {
				if (line.trim() === "") continue;
				try {
					await host.protocol.submit(
						decodeClientRequestLine(line, host.limits),
					);
				} catch (error) {
					await writeError(error);
				}
			}
		} catch (error) {
			await writeError(error);
		}
	} finally {
		try {
			await host.shutdown();
		} finally {
			await output;
		}
	}
};
