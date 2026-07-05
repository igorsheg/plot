import { describe, expect, test } from "bun:test";
import {
	cancelQueuedAction,
	dueQueuedActions,
	emptyActionQueueState,
	enqueueQueuedAction,
	markQueuedActionFailed,
	markQueuedActionSending,
	markQueuedActionSent,
	removeQueuedAction,
	retryQueuedAction,
	undoLatestQueuedAction,
	type QueuedAction,
} from "../src/action-queue.js";

const queued = (id: string, sendAtMs: number): QueuedAction => ({
	id,
	input: {
		sourceId: "source",
		workKey: id,
		actionId: "approve",
		actionLabel: `Approve ${id}`,
	},
	label: `Approve ${id}`,
	enqueuedAtMs: 0,
	sendAtMs,
	status: "pending",
});

describe("action queue state", () => {
	test("undo removes only the newest pending action", () => {
		const state = enqueueQueuedAction(
			enqueueQueuedAction(emptyActionQueueState, queued("one", 5_000)),
			queued("two", 5_000),
		);

		expect(undoLatestQueuedAction(state).items.map((item) => item.id)).toEqual([
			"one",
		]);
	});

	test("cancel cannot remove an action already sending", () => {
		const state = markQueuedActionSending(
			enqueueQueuedAction(emptyActionQueueState, queued("one", 0)),
			"one",
		);

		expect(cancelQueuedAction(state, "one").items).toHaveLength(1);
	});

	test("failure can be retried immediately", () => {
		const failed = markQueuedActionFailed(
			enqueueQueuedAction(emptyActionQueueState, queued("one", 5_000)),
			"one",
			"HTTP 500",
		);
		const retried = retryQueuedAction(failed, "one", 9_000);

		expect(retried.items[0]).toMatchObject({
			id: "one",
			sendAtMs: 9_000,
			status: "pending",
		});
		expect(dueQueuedActions(retried, 9_000).map((item) => item.id)).toEqual([
			"one",
		]);
	});

	test("sent action fades before leaving the queue", () => {
		const state = enqueueQueuedAction(emptyActionQueueState, queued("one", 0));
		const sent = markQueuedActionSent(state, "one");

		expect(sent.items[0]?.status).toBe("sent");
		expect(removeQueuedAction(sent, "one").items).toEqual([]);
	});
});
