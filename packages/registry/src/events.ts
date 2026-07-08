import { AsyncQueue } from "@plot/common/async-queue";
import { readSessionEvents } from "@plot/session/history";
import {
	sessionProtocolVersion,
	type ServerRecord,
} from "@plot/session/protocol";
import type { RuntimeEvent } from "@plot/session/runtime";
import type { RunRecord } from "./record.js";

const toServerEventRecord = (event: RuntimeEvent): ServerRecord => ({
	protocol: sessionProtocolVersion,
	kind: "event",
	event,
});

const eventRecordSequence = (record: ServerRecord): number | undefined =>
	record.kind === "event" ? record.event.sequence : undefined;

export async function* gaplessRunEventRecords(input: {
	readonly sessionFile: string;
	readonly after: number;
	readonly liveRecords: AsyncIterable<ServerRecord>;
}): AsyncIterable<ServerRecord> {
	let frontier = input.after;
	const liveQueue = new AsyncQueue<ServerRecord>();
	const liveIterator = input.liveRecords[Symbol.asyncIterator]();
	const pump = (async () => {
		try {
			for (;;) {
				// eslint-disable-next-line no-await-in-loop -- live pump waits for each child event in order.
				const next = await liveIterator.next();
				if (next.done === true) break;
				liveQueue.offer(next.value, { force: true });
			}
		} catch (error) {
			liveQueue.fail(error);
		} finally {
			liveQueue.close();
		}
	})();
	const unseen = (record: ServerRecord): boolean => {
		const sequence = eventRecordSequence(record);
		if (sequence === undefined || sequence <= frontier) return false;
		frontier = sequence;
		return true;
	};
	try {
		for await (const event of readSessionEvents(input.sessionFile)) {
			const record = toServerEventRecord(event);
			if (unseen(record)) yield record;
		}
		for await (const record of liveQueue) if (unseen(record)) yield record;
	} finally {
		await liveIterator.return?.();
		await pump.catch(() => undefined);
	}
}

export async function* runEventRecords(input: {
	readonly run: RunRecord;
	readonly after: number;
	readonly liveRecords: AsyncIterable<ServerRecord>;
}): AsyncIterable<ServerRecord> {
	if (input.run.sessionFile === undefined) {
		yield* input.liveRecords;
		return;
	}
	yield* gaplessRunEventRecords({
		sessionFile: input.run.sessionFile,
		after: input.after,
		liveRecords: input.liveRecords,
	});
}
