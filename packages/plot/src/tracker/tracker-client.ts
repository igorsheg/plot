import { Context, Effect } from "effect";
import type { Issue, IssueStateEntry } from "../schemas/issue.js";
import type { TrackerError } from "../schemas/errors.js";

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
  ) => Effect.Effect<string | null, TrackerError>;
}

export class TrackerClient extends Context.Tag("TrackerClient")<
  TrackerClient,
  TrackerClientShape
>() {}
