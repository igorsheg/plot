import { describe, expect, test } from "bun:test";
import { RenderScheduler } from "../src/render-scheduler.js";

describe("RenderScheduler", () => {
	test("throttles state renders and coalesces pending work", () => {
		let now = 0;
		let renders = 0;
		let fingerprint = "a";
		const timers: Array<() => void> = [];
		const scheduler = new RenderScheduler({
			minIntervalMs: 50,
			animationFrameMs: 80,
			fingerprint: () => fingerprint,
			isAnimationActive: () => false,
			requestRender: () => {
				renders += 1;
			},
			now: () => now,
			setTimer: (callback) => {
				timers.push(callback);
				return callback;
			},
			clearTimer: () => {},
		});

		now = 100;
		scheduler.notifyChanged();
		expect(renders).toBe(1);

		fingerprint = "b";
		now = 120;
		scheduler.notifyChanged();
		scheduler.notifyChanged();
		expect(renders).toBe(1);
		expect(timers).toHaveLength(1);

		now = 150;
		timers[0]?.();
		expect(renders).toBe(2);
	});

	test("schedules animation frames only while live shimmer is active", () => {
		let now = 100;
		let frame = 1;
		let renders = 0;
		let live = true;
		const timers: Array<() => void> = [];
		const scheduler = new RenderScheduler({
			minIntervalMs: 0,
			animationFrameMs: 80,
			fingerprint: () => `frame:${frame}`,
			isAnimationActive: () => live,
			requestRender: () => {
				renders += 1;
			},
			now: () => now,
			setTimer: (callback) => {
				timers.push(callback);
				return callback;
			},
			clearTimer: () => {},
		});

		scheduler.notifyChanged();
		expect(renders).toBe(1);
		expect(timers).toHaveLength(1);

		frame = 2;
		now += 80;
		timers[0]?.();
		expect(renders).toBe(2);

		live = false;
		frame = 3;
		now += 80;
		timers[1]?.();
		expect(renders).toBe(3);
		expect(timers).toHaveLength(2);
	});
});
