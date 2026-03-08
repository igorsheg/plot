import { Context, Effect } from "effect";
import type { Issue, IssueStateEntry } from "@plot/sdk";
import type { TrackerError } from "@plot/sdk";

export interface TrackerClientShape {
	readonly fetchCandidateIssues: (
		dispatchStates: ReadonlyArray<string>,
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
