import { AsyncQueue } from "@plot/common/async-queue";

export interface EventSourceLike {
	readonly close: () => void;
	readonly addEventListener: (
		type: string,
		listener: (event: Event) => void,
	) => void;
	readonly removeEventListener?: (
		type: string,
		listener: (event: Event) => void,
	) => void;
}

export interface EventSourceMessagesOptions {
	readonly signal?: AbortSignal | undefined;
	readonly eventName?: string;
	readonly createEventSource?: (url: string) => EventSourceLike | undefined;
}

const createBrowserEventSource = (url: string): EventSourceLike | undefined =>
	typeof EventSource === "undefined" ? undefined : new EventSource(url);

export async function* eventSourceMessages(
	url: string,
	options: EventSourceMessagesOptions = {},
): AsyncIterable<MessageEvent> {
	const isAborted = (): boolean => options.signal?.aborted === true;
	if (isAborted()) return;
	const source = (options.createEventSource ?? createBrowserEventSource)(url);
	if (source === undefined) return;
	const eventName = options.eventName ?? "message";
	const queue = new AsyncQueue<MessageEvent>(256);
	const onMessage = (event: Event): void => {
		if (!queue.offer(event as MessageEvent))
			queue.fail(new Error("event stream buffer overflow"));
	};
	const onAbort = (): void => queue.close();
	source.addEventListener(eventName, onMessage);
	options.signal?.addEventListener("abort", onAbort, { once: true });
	try {
		for await (const message of queue) {
			if (isAborted()) break;
			yield message;
		}
	} finally {
		options.signal?.removeEventListener("abort", onAbort);
		source.removeEventListener?.(eventName, onMessage);
		queue.close();
		source.close();
	}
}
