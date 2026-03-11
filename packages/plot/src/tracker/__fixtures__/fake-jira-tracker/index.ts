import { TrackerClient } from "@plot/sdk";
import type { TrackerPlugin } from "@plot/sdk";
import { Effect, Layer } from "effect";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "skills");

const plugin: TrackerPlugin = {
	name: "fake-jira",
	skillPaths: [join(skillsDir, "jira-triage"), join(skillsDir, "jira-sync")],
	factory: () =>
		Layer.succeed(
			TrackerClient,
			TrackerClient.of({
				fetchCandidateIssues: () => Effect.succeed([]),
				fetchIssuesByStates: () => Effect.succeed([]),
				fetchIssueStatesByIds: () => Effect.succeed([]),
				fetchRunContext: () => Effect.succeed(null),
			}),
		),
};

export default plugin;
