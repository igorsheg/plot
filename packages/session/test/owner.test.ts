import { expect, test } from "bun:test";
import {
	createOwner,
	type SessionCloseContext,
	type SessionIdentity,
} from "../src/owner.js";

interface TestSession {
	readonly id: number;
	readonly identity: SessionIdentity<string>;
	readonly close: (context: SessionCloseContext) => Promise<void>;
}

const ownerHarness = () => {
	let nextId = 1;
	const closes: SessionCloseContext[] = [];
	const owner = createOwner<string, string, TestSession>(
		async ({ identity }) => ({
			id: nextId++,
			identity,
			close: async (context) => {
				closes.push(context);
			},
		}),
		() => new Error("owner closed"),
	);
	return { owner, closes };
};

test("owner coalesces aliases and starts fresh after stop", async () => {
	const { owner, closes } = ownerHarness();
	const [first, same] = await Promise.all([
		owner.start({
			key: "/real/workflow",
			aliases: ["/link/workflow"],
			target: "first",
		}),
		owner.start({
			key: "/real/workflow",
			aliases: ["/other-link/workflow"],
			target: "second",
		}),
	]);
	expect(first.started).toBe(true);
	expect(same.started).toBe(false);
	expect(same.session).toBe(first.session);
	expect(first.session.identity.aliases).toEqual(
		new Set(["/real/workflow", "/link/workflow", "/other-link/workflow"]),
	);
	expect(owner.find(["/other-link/workflow"])).toBe(first.session);

	expect(await owner.stop(["/link/workflow"])).toBe(first.session);
	expect(closes).toEqual([{ reason: "stop" }]);
	expect(owner.find(["/real/workflow"])).toBeUndefined();

	const restarted = await owner.start({
		key: "/real/workflow",
		target: "third",
	});
	expect(restarted.session.id).not.toBe(first.session.id);
	await owner.dispose();
});

test("owner starts fresh after an in-flight stop", async () => {
	let nextId = 1;
	let finish!: () => void;
	const owner = createOwner<string, string, TestSession>(
		async ({ identity }) => ({
			id: nextId++,
			identity,
			close: () =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		}),
	);
	const first = (await owner.start({ key: "workflow", target: "first" }))
		.session;
	const stopping = owner.stop(["workflow"]);
	const restarting = owner.start({ key: "workflow", target: "second" });
	finish();
	await stopping;
	const second = (await restarting).session;
	expect(second).not.toBe(first);
	const disposing = owner.dispose();
	finish();
	await disposing;
});

test("owner handles failure and exhaustive disposal", async () => {
	const { owner, closes } = ownerHarness();
	const first = (await owner.start({ key: "first", target: "first" })).session;
	await owner.start({ key: "second", target: "second" });
	const failure = new Error("worker exited");
	await owner.fail(first.identity, first, failure);
	expect(closes[0]).toEqual({ reason: "failure", error: failure });

	await owner.dispose();
	expect(closes.map((context) => context.reason)).toEqual([
		"failure",
		"dispose",
	]);
	expect(owner.sessions()).toEqual([]);
	await expect(owner.start({ key: "third", target: "third" })).rejects.toThrow(
		"owner closed",
	);
});
