import {
	createProtocolSessionHost,
	type CreateSessionHostOptions,
} from "./host.js";
import { decodeClientRequestLine, encodeServerRecordLine } from "./protocol.js";
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
						for await (const event of host.runtime.events()) {
							if (signal.aborted) return;
							// eslint-disable-next-line no-await-in-loop -- events render in order.
							await onEvent(event);
						}
					},
				});
	try {
		await host.runtime.start();
		await host.runtime.tickOnce();
	} finally {
		await host.shutdown();
		await events?.done;
	}
};

/** Serve the session protocol over JSONL stdio: the loop registry children run. */
export const serveSessionStdio = async (
	options: ServeSessionStdioOptions,
): Promise<void> => {
	const host = await createProtocolSessionHost(options);
	const outputDone = (async () => {
		for await (const record of host.protocol.output())
			await options.writeLine(encodeServerRecordLine(record));
	})();
	try {
		await options.writeLine(
			encodeServerRecordLine(await host.protocol.welcome()),
		);
		const decoder = new TextDecoder();
		let buffer = "";
		for await (const chunk of options.stdin) {
			buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk);
			for (;;) {
				const index = buffer.indexOf("\n");
				if (index === -1) break;
				const line = buffer.slice(0, index).trim();
				buffer = buffer.slice(index + 1);
				if (line !== "") {
					// eslint-disable-next-line no-await-in-loop -- stdin protocol requests are submitted in order.
					await host.protocol.submit(decodeClientRequestLine(line));
				}
			}
		}
	} finally {
		await host.shutdown();
		await outputDone;
	}
};
