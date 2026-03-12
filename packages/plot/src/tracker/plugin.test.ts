import { describe, expect, test } from "bun:test";
import { TrackerClient } from "@plot/sdk";
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ResolvedConfig } from "../core/config-service.js";
import { makeTrackerLayer, resolvePlugin } from "../runtime-builder.js";

const fixturesDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"__fixtures__",
);

const makeMinimalConfig = (trackerKind: string): ResolvedConfig =>
	new ResolvedConfig({ tracker: { kind: trackerKind } });

const resolveTrackerPlugin = (config: ResolvedConfig) =>
	Effect.runPromise(resolvePlugin(config));

const evaluateTrackerLayer = async (config: ResolvedConfig) => {
	const resolvedPlugin = await resolveTrackerPlugin(config);

	return Effect.runPromise(
		Effect.gen(function* () {
			const tracker = yield* TrackerClient;
			return yield* tracker.fetchCandidateIssues([]);
		}).pipe(Effect.provide(makeTrackerLayer(resolvedPlugin))),
	);
};

describe("tracker plugin system", () => {
	test("external plugin with skillPaths threads them through dynamic import", async () => {
		const config = makeMinimalConfig(
			join(fixturesDir, "fake-jira-tracker/index.ts"),
		);

		const resolvedPlugin = await resolveTrackerPlugin(config);
		await evaluateTrackerLayer(config);

		expect(resolvedPlugin.skillPaths.length).toBe(2);
		expect(
			resolvedPlugin.skillPaths.some((path) => path.includes("jira-triage")),
		).toBe(true);
		expect(
			resolvedPlugin.skillPaths.some((path) => path.includes("jira-sync")),
		).toBe(true);
	});

	test("external plugin without skillPaths defaults to empty", async () => {
		const config = makeMinimalConfig(
			join(fixturesDir, "fake-minimal-tracker/index.ts"),
		);

		const resolvedPlugin = await resolveTrackerPlugin(config);
		await evaluateTrackerLayer(config);

		expect(resolvedPlugin.skillPaths).toEqual([]);
	});

	test("external plugin provides a working TrackerClient", async () => {
		const config = makeMinimalConfig(
			join(fixturesDir, "fake-jira-tracker/index.ts"),
		);
		const resolvedPlugin = await resolveTrackerPlugin(config);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const tracker = yield* TrackerClient;
				return {
					candidateIssues: yield* tracker.fetchCandidateIssues([]),
					issuesByStates: yield* tracker.fetchIssuesByStates([]),
					issueStatesByIds: yield* tracker.fetchIssueStatesByIds([]),
					runContext: yield* tracker.fetchRunContext("issue-1", "todo"),
				};
			}).pipe(Effect.provide(makeTrackerLayer(resolvedPlugin))),
		);

		expect(result).toEqual({
			candidateIssues: [],
			issuesByStates: [],
			issueStatesByIds: [],
			runContext: null,
		});
	});

	test("syncs github repo into process env from resolved config", async () => {
		const previous = process.env["GITHUB_REPO"];

		try {
			const workflowConfig = new ResolvedConfig(
				{
					tracker: {
						kind: join(fixturesDir, "fake-minimal-tracker/index.ts"),
					},
				},
				{ githubRepo: "workflow/repo" },
			);
			await resolveTrackerPlugin(workflowConfig);
			expect(process.env["GITHUB_REPO"]).toBe("workflow/repo");

			const emptyConfig = makeMinimalConfig(
				join(fixturesDir, "fake-minimal-tracker/index.ts"),
			);
			await resolveTrackerPlugin(emptyConfig);
			expect(process.env["GITHUB_REPO"]).toBeUndefined();
		} finally {
			if (previous === undefined) {
				delete process.env["GITHUB_REPO"];
			} else {
				process.env["GITHUB_REPO"] = previous;
			}
		}
	});
});
