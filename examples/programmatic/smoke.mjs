import assert from "node:assert/strict";
import { createPlot } from "plot-ai";
import { defineExtension, defineWorkflow } from "plot-ai/sdk";

let discoveries = 0;
let acknowledged = false;
let resolveOperatorAction;
const operatorActionHandled = new Promise(
	(resolve) => (resolveOperatorAction = resolve),
);

const extension = defineExtension({
	id: "in-memory-smoke",
	create: () => ({
		discover: () => {
			discoveries += 1;
			return acknowledged
				? []
				: [
						{
							id: "smoke-work",
							status: "blocked",
							blockedReason: "Acknowledge the smoke test",
							operatorActions: [{ id: "acknowledge", label: "Acknowledge" }],
						},
					];
		},
		operatorAction: ({ actionId, actionLabel }) => {
			assert.equal(actionId, "acknowledge");
			assert.equal(actionLabel, "Acknowledge");
			acknowledged = true;
			resolveOperatorAction();
		},
	}),
});

const workflow = defineWorkflow({
	name: "programmatic-smoke",
	agent: {
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		noTools: true,
	},
	resources: {
		systemPrompt: "./this-is-literal-text-not-a-file.md",
	},
	extension: { use: extension },
	plot: { tickIntervalMs: 60_000 },
	prompt: "Blocked work is never dispatched in this smoke test.",
});

const plot = await createPlot({
	cwd: process.cwd(),
	credentials: {
		// Discovery returns only blocked work, so no provider request is made.
		anthropic: { type: "api-key", apiKey: "unused-smoke-key" },
	},
});

try {
	const [session, sameSession] = await Promise.all([
		plot.start(workflow),
		plot.start(workflow),
	]);
	assert.equal(sameSession, session, "concurrent starts must coalesce");
	assert.equal(plot.sessions().length, 1);

	const observation = session.observe();
	const unsubscribe = observation.subscribe(() => {
		const snapshot = observation.getSnapshot();
		console.log("update", snapshot.status, `seq=${snapshot.sequence}`);
	});

	try {
		await waitForStatus(observation, "idle");
		assert.equal(session.state, "online");
		assert.ok(discoveries >= 1, "automatic ticking must run discovery");

		const work = observation.getSnapshot().workItems[0];
		assert.ok(work, "automatic ticking must publish blocked work");
		assert.equal(
			await session.performOperatorAction({
				sourceId: work.sourceId,
				workKey: work.workKey,
				actionId: "acknowledge",
			}),
			true,
		);
		await withTimeout(operatorActionHandled, "Operator action timed out");
		await session.tick(); // May coalesce with the action's reconciliation tick.
		await session.tick();
		assert.equal(observation.getSnapshot().workItems.length, 0);
		assert.equal(session.state, "online");

		const firstId = session.id;
		await session.stop();
		assert.equal(session.state, "stopped");
		assert.equal(observation.getSnapshot().status, "stopped");
		assert.equal(plot.find(workflow), undefined);

		const restarted = await plot.start(workflow);
		assert.notEqual(
			restarted.id,
			firstId,
			"restart must create a fresh Session",
		);
		await restarted.stop();
	} finally {
		unsubscribe();
		observation.close();
	}
} finally {
	await plot.dispose();
}

console.log("programmatic smoke test passed");

async function withTimeout(promise, message) {
	let timeout;
	try {
		await Promise.race([
			promise,
			new Promise((_, reject) => {
				timeout = setTimeout(() => reject(new Error(message)), 5_000);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}

async function waitForStatus(observation, expected) {
	if (observation.getSnapshot().status === expected) return;
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			unsubscribe();
			reject(new Error(`timed out waiting for Session status ${expected}`));
		}, 5_000);
		const unsubscribe = observation.subscribe(() => {
			if (observation.getSnapshot().status !== expected) return;
			clearTimeout(timeout);
			unsubscribe();
			resolve();
		});
	});
}
