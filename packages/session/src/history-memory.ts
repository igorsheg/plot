import type { RuntimeEvent, SessionEventStore } from "./runtime.js";

export const createMemorySessionEventStore = (
	capacity = 100_000,
): SessionEventStore => {
	const events: RuntimeEvent[] = [];
	let closed = false;
	return {
		append: async (event) => {
			if (closed) throw new Error("Session event store is closed");
			if (events.length === capacity)
				throw new Error(`Session event capacity ${capacity} exceeded`);
			events.push(event);
		},
		read: (after = 0) => ({
			async *[Symbol.asyncIterator]() {
				for (const event of events) if (event.sequence > after) yield event;
			},
		}),
		close: async () => {
			closed = true;
			events.length = 0;
		},
	};
};
