import { Effect, ServiceMap } from "effect";
import type { Issue, IssueStateEntry, TrackerRunContext } from "@plot/sdk";
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

	readonly fetchRunContext: (
		issueId: string,
		state: string,
	) => Effect.Effect<TrackerRunContext | null, TrackerError>;
}

export class TrackerClient extends ServiceMap.Service<TrackerClient, TrackerClientShape>()(
	"TrackerClient",
) {}
