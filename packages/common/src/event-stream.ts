import { AsyncQueue } from "./async-queue.js";

export class EventStream<T, R = T> implements AsyncIterable<T> {
	private readonly queue = new AsyncQueue<T>();
	private done = false;
	private readonly finalResultPromise: Promise<R>;
	private resolveFinalResult!: (result: R) => void;

	constructor(
		private readonly isComplete: (event: T) => boolean = () => false,
		private readonly extractResult: (event: T) => R = (event) =>
			event as unknown as R,
	) {
		this.finalResultPromise = new Promise((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}

	push(event: T): void {
		if (this.done) return;
		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}
		this.queue.offer(event);
		if (this.done) this.queue.close();
	}

	end(result?: R): void {
		if (this.done) return;
		this.done = true;
		if (result !== undefined) this.resolveFinalResult(result);
		this.queue.close();
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return this.queue[Symbol.asyncIterator]();
	}

	result(): Promise<R> {
		return this.finalResultPromise;
	}
}

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
