import { TrackerClient } from "@plot/sdk";
import type { TrackerPlugin } from "@plot/sdk";
import { Effect, Layer } from "effect";

const plugin: TrackerPlugin = {
	name: "fake-minimal",
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
