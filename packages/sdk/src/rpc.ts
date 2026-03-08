import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { PlotApiError } from "./errors.js";
import { IssueDetail, IssueEventLog, RuntimeSnapshot } from "./schemas/orchestrator.js";

export class RefreshResult extends Schema.Class<RefreshResult>("RefreshResult")({
  queued: Schema.Boolean,
  coalesced: Schema.Boolean,
  requestedAt: Schema.DateTimeUtc,
  operations: Schema.Array(Schema.String),
}) {}

export class PlotRpcs extends RpcGroup.make(
  Rpc.make("GetState", {
    success: RuntimeSnapshot,
    error: PlotApiError,
  }),
  Rpc.make("GetIssue", {
    success: IssueDetail,
    error: PlotApiError,
    payload: { identifier: Schema.String },
  }),
  Rpc.make("TriggerRefresh", {
    success: RefreshResult,
    error: PlotApiError,
  }),
  Rpc.make("GetEventLog", {
    success: IssueEventLog,
    error: PlotApiError,
    payload: { identifier: Schema.String },
  }),
) {}
