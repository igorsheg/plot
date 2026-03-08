import { Schema } from "effect";

export class IssueNotFound extends Schema.TaggedError<IssueNotFound>()("IssueNotFound", {
  identifier: Schema.String,
  message: Schema.String,
}) {}

export class OrchestratorUnavailable extends Schema.TaggedError<OrchestratorUnavailable>()(
  "OrchestratorUnavailable",
  {
    message: Schema.String,
  },
) {}

export const PlotApiError = Schema.Union(IssueNotFound, OrchestratorUnavailable);
export type PlotApiError = typeof PlotApiError.Type;
