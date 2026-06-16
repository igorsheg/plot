import { describe, expect, test } from "bun:test";
import { emptyProjection } from "@plot/control/projection";
import { createProjectionCoalescer } from "../src/app/dashboard/projection-coalescer";

const proj = (frontier: number) => ({
	...emptyProjection("s", "wf"),
	frontier,
});

const harness = () => {
	let clock = 0;
	let nextId = 0;
	const tasks = new Map<number, { at: number; fn: () => void }>();
	return {
		now: () => clock,
		schedule: (fn: () => void, ms: number) => {
			const id = ++nextId;
			tasks.set(id, { at: clock + ms, fn });
			return id;
		},
		cancel: (id: number) => {
			tasks.delete(id);
		},
		advance: (ms: number) => {
			clock += ms;
			for (const [id, task] of [...tasks])
				if (task.at <= clock) {
					tasks.delete(id);
					task.fn();
				}
		},
	};
};

describe("projection coalescer", () => {
	test("publishes the first change immediately (leading edge)", () => {
		const h = harness();
		const published: number[] = [];
		const c = createProjectionCoalescer({
			intervalMs: 100,
			publish: (p) => published.push(p.frontier),
			now: h.now,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		c.push(proj(1));
		expect(published).toEqual([1]);
	});

	test("coalesces a burst into one trailing flush carrying the freshest", () => {
		const h = harness();
		const published: number[] = [];
		const c = createProjectionCoalescer({
			intervalMs: 100,
			publish: (p) => published.push(p.frontier),
			now: h.now,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		c.push(proj(1)); // leading edge → publishes 1
		h.advance(10);
		c.push(proj(2)); // within window → armed
		h.advance(10);
		c.push(proj(3)); // within window → replaces pending
		expect(published).toEqual([1]);
		h.advance(100); // trailing flush fires with freshest
		expect(published).toEqual([1, 3]);
	});

	test("never publishes an unchanged frontier twice (dedup)", () => {
		const h = harness();
		const published: number[] = [];
		const c = createProjectionCoalescer({
			intervalMs: 100,
			publish: (p) => published.push(p.frontier),
			now: h.now,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		c.push(proj(5));
		h.advance(200);
		c.push(proj(5)); // same frontier → armed but flush dedups
		h.advance(200);
		expect(published).toEqual([5]);
	});

	test("replace publishes immediately and drops a pending flush", () => {
		const h = harness();
		const published: number[] = [];
		const c = createProjectionCoalescer({
			intervalMs: 100,
			publish: (p) => published.push(p.frontier),
			now: h.now,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		c.push(proj(1)); // leading → 1
		h.advance(10);
		c.push(proj(2)); // armed at t=110
		c.replace(proj(9)); // snapshot → immediate, cancels pending
		expect(published).toEqual([1, 9]);
		h.advance(200); // the cancelled flush must not fire
		expect(published).toEqual([1, 9]);
	});
});
