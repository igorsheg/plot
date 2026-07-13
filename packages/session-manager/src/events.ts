import { AsyncQueue } from "@plot/common/async-queue";
import { readSessionEvents } from "@plot/session/history";
import type { RuntimeEvent } from "@plot/session/runtime";

/** Replay durable Session History, then continue live without a sequence gap. */
export async function* sessionEvents(input: {
	readonly historyPath: string;
	readonly after?: number;
	readonly live?: AsyncIterable<RuntimeEvent>;
}): AsyncIterable<RuntimeEvent> {
	let frontier = input.after ?? 0;
	const liveIterator = input.live?.[Symbol.asyncIterator]();
	const liveQueue = new AsyncQueue<RuntimeEvent>();
	if (liveIterator === undefined) liveQueue.close();
	const pump =
		liveIterator === undefined
			? Promise.resolve()
			: (async () => {
					try {
						for (;;) {
							// eslint-disable-next-line no-await-in-loop -- live events are ordered.
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
	const unseen = (event: RuntimeEvent): boolean => {
		if (event.sequence <= frontier) return false;
		frontier = event.sequence;
		return true;
	};
	try {
		for await (const event of readSessionEvents(input.historyPath))
			if (unseen(event)) yield event;
		for await (const event of liveQueue) if (unseen(event)) yield event;
	} finally {
		await liveIterator?.return?.();
		await pump.catch(() => undefined);
	}
}
