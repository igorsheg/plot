import { describe, expect, test } from "bun:test";
import { TrackerClient } from "@plot/sdk";
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ResolvedConfig } from "../core/config-service.js";
import { makeTrackerLayer } from "../runtime-builder.js";

const fixturesDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"__fixtures__",
);

const makeMinimalConfig = (trackerKind: string): ResolvedConfig =>
	new ResolvedConfig({ tracker: { kind: trackerKind } });

const evaluateTrackerLayer = (config: ResolvedConfig) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const tracker = yield* TrackerClient;
			return yield* tracker.fetchCandidateIssues([]);
		}).pipe(Effect.provide(makeTrackerLayer(config))),
	);

describe("tracker plugin system", () => {
	test("external plugin with skillPaths threads them through dynamic import", async () => {
		const config = makeMinimalConfig(
			join(fixturesDir, "fake-jira-tracker/index.ts"),
		);

		await evaluateTrackerLayer(config);

		expect(config.trackerSkillPaths.length).toBe(2);
		expect(
			config.trackerSkillPaths.some((path) => path.includes("jira-triage")),
		).toBe(true);
		expect(
			config.trackerSkillPaths.some((path) => path.includes("jira-sync")),
		).toBe(true);
	});

	test("external plugin without skillPaths defaults to empty", async () => {
		const config = makeMinimalConfig(
			join(fixturesDir, "fake-minimal-tracker/index.ts"),
		);

		await evaluateTrackerLayer(config);

		expect(config.trackerSkillPaths).toEqual([]);
	});

	test("external plugin provides a working TrackerClient", async () => {
		const config = makeMinimalConfig(
			join(fixturesDir, "fake-jira-tracker/index.ts"),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const tracker = yield* TrackerClient;
				return {
					candidateIssues: yield* tracker.fetchCandidateIssues([]),
					issuesByStates: yield* tracker.fetchIssuesByStates([]),
					issueStatesByIds: yield* tracker.fetchIssueStatesByIds([]),
					runContext: yield* tracker.fetchRunContext("issue-1", "todo"),
				};
			}).pipe(Effect.provide(makeTrackerLayer(config))),
		);

		expect(result).toEqual({
			candidateIssues: [],
			issuesByStates: [],
			issueStatesByIds: [],
			runContext: null,
		});
	});
});
