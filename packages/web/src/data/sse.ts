import type { ProjectableEvent } from "@plot/projection";
import { eventSourceMessages } from "./sse-client.js";

const jsonRecord = (value: string): Record<string, unknown> | undefined => {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed !== null && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
};

export const projectionEventFromSse = (
	data: string,
): ProjectableEvent | undefined => {
	const record = jsonRecord(data);
	if (record?.["kind"] !== "event") return undefined;
	const event = record["event"];
	return event !== null && typeof event === "object"
		? (event as ProjectableEvent)
		: undefined;
};

export async function* projectionEvents(
	url: string,
	signal?: AbortSignal,
): AsyncIterable<ProjectableEvent> {
	for await (const message of eventSourceMessages(url, {
		eventName: "plot",
		signal,
	})) {
		const event = projectionEventFromSse(String(message.data));
		if (event !== undefined) yield event;
	}
}
