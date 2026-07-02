import { describe, expect, test } from "bun:test";
import { evaluatePr, firstSeenSeedMs } from "./eligibility.ts";
import type { EligibilityConfig, PrEligibilityFacts } from "./eligibility.ts";

const config: EligibilityConfig = {
	includeDrafts: false,
	includeBots: false,
	quietPeriodMs: 90_000,
};

const pr = (
	overrides: Partial<PrEligibilityFacts> = {},
): PrEligibilityFacts => ({
	title: "Fix checkout totals",
	isDraft: false,
	authorIsBot: false,
	labels: [],
	head: "sha-1",
	...overrides,
});

const settled = { headFirstSeenAtMs: 0, nowMs: 100_000 };
const justPushed = { headFirstSeenAtMs: 0, nowMs: 10_000 };
const idle = { rereviewRequested: false };

describe("firstSeenSeedMs", () => {
	test("seeds from updatedAt, clamped to now", () => {
		const now = Date.parse("2026-07-02T12:00:00Z");
		// settled PR: old updatedAt passes the quiet period immediately
		expect(firstSeenSeedMs(now, "2026-06-30T08:00:00Z")).toBe(
			Date.parse("2026-06-30T08:00:00Z"),
		);
		// clock skew or fresh push: never seeds in the future
		expect(firstSeenSeedMs(now, "2026-07-02T12:05:00Z")).toBe(now);
		expect(firstSeenSeedMs(now, "not a date")).toBe(now);
		expect(firstSeenSeedMs(now)).toBe(now);
	});
});

describe("evaluatePr", () => {
	test("gates, holds, and review states", () => {
		// omit: label gate, title opt-out, bot authors
		expect(
			evaluatePr({
				pr: pr(),
				config: { ...config, requireLabel: "ai-review" },
				operator: idle,
				...settled,
			}),
		).toMatchObject({ kind: "omit", reason: "missing label ai-review" });
		expect(
			evaluatePr({
				pr: pr({ title: "WIP thing [skip review]", labels: ["ai-review"] }),
				config,
				operator: idle,
				...settled,
			}),
		).toMatchObject({ kind: "omit" });
		expect(
			evaluatePr({
				pr: pr({ authorIsBot: true }),
				config,
				operator: idle,
				...settled,
			}),
		).toMatchObject({ kind: "omit", reason: "bot-authored pull request" });

		// holds: draft, operator skip (released by a new head), done, settling
		expect(
			evaluatePr({
				pr: pr({ isDraft: true }),
				config,
				operator: idle,
				...settled,
			}),
		).toMatchObject({ kind: "hold", label: "draft" });
		expect(
			evaluatePr({
				pr: pr(),
				config,
				operator: { skippedAtHead: "sha-1", rereviewRequested: false },
				...settled,
			}),
		).toMatchObject({ kind: "hold", label: "skipped" });
		// a new head releases the operator skip
		expect(
			evaluatePr({
				pr: pr({ head: "sha-2" }),
				config,
				operator: { skippedAtHead: "sha-1", rereviewRequested: false },
				...settled,
			}),
		).toMatchObject({ kind: "review", state: "fresh" });
		expect(
			evaluatePr({
				pr: pr(),
				anchor: { status: "done", head: "sha-1" },
				config,
				operator: idle,
				...settled,
			}),
		).toMatchObject({ kind: "hold", label: "reviewed" });
		expect(
			evaluatePr({ pr: pr(), config, operator: idle, ...justPushed }),
		).toMatchObject({ kind: "hold", label: "settling" });

		// review states: fresh, new head, resume (bypasses settling), re-review
		expect(
			evaluatePr({ pr: pr(), config, operator: idle, ...settled }),
		).toMatchObject({ kind: "review", state: "fresh" });
		expect(
			evaluatePr({
				pr: pr({ head: "sha-2" }),
				anchor: { status: "done", head: "sha-1" },
				config,
				operator: idle,
				...settled,
			}),
		).toMatchObject({ kind: "review", state: "new head" });
		expect(
			evaluatePr({
				pr: pr(),
				anchor: { status: "reviewing", head: "sha-1" },
				config,
				operator: idle,
				...justPushed,
			}),
		).toMatchObject({ kind: "review", state: "resume" });
		expect(
			evaluatePr({
				pr: pr(),
				anchor: { status: "done", head: "sha-1" },
				config,
				operator: { rereviewRequested: true },
				...justPushed,
			}),
		).toMatchObject({ kind: "review", state: "re-review" });
	});
});
