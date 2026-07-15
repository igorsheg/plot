import { AsyncQueue } from "@plot/common/async-queue";
import { readSessionEvents } from "@plot/session/history";
import type { RuntimeEvent } from "@plot/session/runtime";

const LIVE_REPLAY_CAPACITY = 256;

/** Replay durable history, then continue live without loss or duplication. */
export async function* sessionEvents(input: {
	readonly historyPath: string;
	readonly after?: number;
	readonly live?: () => AsyncIterable<RuntimeEvent>;
}): AsyncIterable<RuntimeEvent> {
	let frontier = input.after ?? 0;
	const replay = async function* () {
		for await (const event of readSessionEvents(input.historyPath)) {
			if (event.sequence <= frontier) continue;
			if (event.sequence !== frontier + 1)
				throw new Error(
					`Session history sequence gap: expected ${frontier + 1}, received ${event.sequence}`,
				);
			frontier = event.sequence;
			yield event;
		}
	};
	if (input.live === undefined) {
		yield* replay();
		return;
	}
	for (;;) {
		const iterator = input.live()[Symbol.asyncIterator]();
		const buffered = new AsyncQueue<RuntimeEvent>({
			capacity: LIVE_REPLAY_CAPACITY,
		});
		let overflow = false;
		let ended = false;
		const pump = (async () => {
			try {
				for (;;) {
					const next = await iterator.next();
					if (next.done === true) {
						ended = true;
						break;
					}
					if (!buffered.offer(next.value)) {
						overflow = true;
						break;
					}
				}
			} catch {
				overflow = true;
			} finally {
				buffered.close();
			}
		})();
		try {
			yield* replay();
			for await (const event of buffered) {
				if (event.sequence <= frontier) continue;
				if (event.sequence !== frontier + 1) yield* replay();
				if (event.sequence <= frontier) continue;
				if (event.sequence !== frontier + 1)
					throw new Error(
						`Session live sequence gap: expected ${frontier + 1}, received ${event.sequence}`,
					);
				frontier = event.sequence;
				yield event;
			}
		} finally {
			await iterator.return?.();
			await pump.catch(() => undefined);
		}
		if (!overflow || ended) return;
		// Overflow is recoverable because every live event is durable before
		// publication. Subscribe again before replaying the missing suffix.
	}
}
