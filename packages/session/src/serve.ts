import {
	createProtocolSessionHost,
	type CreateSessionHostOptions,
} from "./host.js";
import { jsonlLines } from "@plot/common/jsonl";
import {
	decodeClientRequestLine,
	encodeServerRecordLine,
	makeError,
	toProtocolBoundaryError,
} from "./protocol.js";
import { startOwnedTask, type RuntimeEvent } from "./runtime.js";

export interface RunSessionOnceOptions extends CreateSessionHostOptions {
	readonly onEvent?: (event: RuntimeEvent) => Promise<void> | void;
}

export interface ServeSessionStdioOptions extends CreateSessionHostOptions {
	readonly stdin: AsyncIterable<string | Uint8Array>;
	readonly writeLine: (line: string) => Promise<void> | void;
}

/** Run one session for a single tick, streaming runtime events to onEvent. */
export const runSessionOnce = async (
	options: RunSessionOnceOptions,
): Promise<void> => {
	const host = await createProtocolSessionHost(options);
	const onEvent = options.onEvent;
	const events =
		onEvent === undefined
			? undefined
			: startOwnedTask({
					name: "session.serve.events",
					run: async (signal) => {
						for await (const event of host.runtime.events(signal)) {
							// eslint-disable-next-line no-await-in-loop -- events render in order.
							await onEvent(event);
						}
					},
				});
	try {
		await host.runtime.runOnce();
	} finally {
		try {
			await host.shutdown();
		} finally {
			await events?.done;
		}
	}
};

/** Serve the session protocol over bounded JSONL stdio. */
export const serveSessionStdio = async (
	options: ServeSessionStdioOptions,
): Promise<void> => {
	const host = await createProtocolSessionHost(options);
	let writeChain = Promise.resolve();
	const writeLine = (line: string): Promise<void> => {
		writeChain = writeChain.then(() => options.writeLine(line));
		return writeChain;
	};
	const writeBoundaryError = (error: unknown): Promise<void> => {
		const boundary = toProtocolBoundaryError(error);
		return writeLine(
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
	const outputDone = (async () => {
		for await (const record of host.protocol.output())
			await writeLine(encodeServerRecordLine(record, host.limits));
	})();
	try {
		await writeLine(
			encodeServerRecordLine(await host.protocol.welcome(), host.limits),
		);
		try {
			for await (const line of jsonlLines(options.stdin, {
				maxLineBytes: host.limits.maxInputLineBytes,
			})) {
				if (line.trim() === "") continue;
				try {
					// eslint-disable-next-line no-await-in-loop -- protocol requests are submitted in order.
					await host.protocol.submit(
						decodeClientRequestLine(line, host.limits),
					);
				} catch (error) {
					// eslint-disable-next-line no-await-in-loop -- boundary failures preserve output ordering.
					await writeBoundaryError(error);
				}
			}
		} catch (error) {
			await writeBoundaryError(error);
		}
	} finally {
		try {
			await host.shutdown();
		} finally {
			await outputDone;
		}
	}
};
