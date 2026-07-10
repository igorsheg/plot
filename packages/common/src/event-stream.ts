import { AsyncQueue } from "./async-queue.js";

export class EventHub<T> {
	private readonly subscribers = new Set<AsyncQueue<T>>();
	private closed = false;

	constructor(private readonly capacity = 256) {}

	publish(event: T): void {
		if (this.closed) return;
		for (const subscriber of this.subscribers) subscriber.offer(event);
	}

	subscribe(signal?: AbortSignal): AsyncIterable<T> {
		const subscriber = new AsyncQueue<T>({
			capacity: this.capacity,
			overflow: "drop-oldest",
		});
		const abort = () => {
			subscriber.close();
			this.subscribers.delete(subscriber);
		};
		if (this.closed || signal?.aborted) subscriber.close();
		else {
			this.subscribers.add(subscriber);
			signal?.addEventListener("abort", abort, { once: true });
		}
		const unsubscribe = () => {
			this.subscribers.delete(subscriber);
			signal?.removeEventListener("abort", abort);
		};
		return {
			[Symbol.asyncIterator]: async function* () {
				try {
					for await (const event of subscriber) yield event;
				} finally {
					unsubscribe();
				}
			},
		};
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const subscriber of this.subscribers) subscriber.close();
		this.subscribers.clear();
	}
}
