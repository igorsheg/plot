export interface AsyncQueueOptions {
	readonly capacity?: number;
	readonly overflow?: "reject" | "drop-oldest";
}

export class AsyncQueue<T> implements AsyncIterable<T> {
	private readonly capacity: number;
	private readonly overflow: "reject" | "drop-oldest";
	private readonly queue: T[] = [];
	private readonly waiters: ((result: IteratorResult<T>) => void)[] = [];
	private closed = false;
	private failure: unknown;

	constructor(options: AsyncQueueOptions = {}) {
		this.capacity = options.capacity ?? Number.POSITIVE_INFINITY;
		this.overflow = options.overflow ?? "reject";
	}

	offer(value: T): boolean {
		if (this.closed) return false;
		const waiter = this.waiters.shift();
		if (waiter) {
			waiter({ value, done: false });
			return true;
		}
		if (this.queue.length >= this.capacity) {
			if (this.overflow === "reject") return false;
			this.queue.shift();
		}
		this.queue.push(value);
		return true;
	}

	async take(): Promise<T> {
		const value = this.queue.shift();
		if (value !== undefined) return value;
		if (this.failure) throw this.failure;
		if (this.closed) throw new Error("queue closed");
		const result = await new Promise<IteratorResult<T>>((resolve) =>
			this.waiters.push(resolve),
		);
		if (result.done) throw new Error("queue closed");
		return result.value;
	}

	drain(): T[] {
		return this.queue.splice(0);
	}

	fail(error: unknown): void {
		if (this.closed) return;
		this.failure = error;
		this.close();
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		while (this.waiters.length > 0) {
			this.waiters.shift()!({ value: undefined, done: true });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			const value = this.queue.shift();
			if (value !== undefined) {
				yield value;
				continue;
			}
			if (this.failure) throw this.failure;
			if (this.closed) return;
			const result = await new Promise<IteratorResult<T>>((resolve) =>
				this.waiters.push(resolve),
			);
			if (this.failure) throw this.failure;
			if (result.done) return;
			yield result.value;
		}
	}
}
