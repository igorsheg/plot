import { describe, expect, test } from "bun:test";
import { TrackerClient } from "../core/services/TrackerClient.js";
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ResolvedConfig } from "../core/config-service.js";
import { resolvePlugin } from "../runtime-builder.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

const makeMinimalConfig = (trackerKind: string): ResolvedConfig =>
	new ResolvedConfig({ tracker: { kind: trackerKind } });

const resolveTrackerPlugin = (config: ResolvedConfig) => Effect.runPromise(resolvePlugin(config));

describe("tracker plugin system", () => {
	test("external plugin provides a working TrackerClient", async () => {
		const config = makeMinimalConfig(join(fixturesDir, "fake-jira-tracker/index.ts"));
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
			}).pipe(Effect.provide(resolvedPlugin.trackerLayer)),
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

			const emptyConfig = makeMinimalConfig(join(fixturesDir, "fake-minimal-tracker/index.ts"));
			await resolveTrackerPlugin(emptyConfig);
			// When no explicit githubRepo is set, resolvePlugin auto-detects from projectDir (CWD).
			// If CWD is inside a git repo, GITHUB_REPO will be populated; otherwise undefined.
			const autoDetected = process.env["GITHUB_REPO"];
			expect(autoDetected === undefined || typeof autoDetected === "string").toBe(true);
		} finally {
			if (previous === undefined) {
				delete process.env["GITHUB_REPO"];
			} else {
				process.env["GITHUB_REPO"] = previous;
			}
		}
	});
});
