import { Context, Effect } from "effect";
import type { Issue, IssueStateEntry } from "@plot/shared";
import type { TrackerError } from "@plot/shared";

export interface TrackerClientShape {
	readonly fetchCandidateIssues: (
		activeStates: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<Issue>, TrackerError>;

	readonly fetchIssuesByStates: (
		states: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<Issue>, TrackerError>;

	readonly fetchIssueStatesByIds: (
		ids: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<IssueStateEntry>, TrackerError>;
}

export class TrackerClient extends Context.Tag("TrackerClient")<
	TrackerClient,
	TrackerClientShape
>() {}
