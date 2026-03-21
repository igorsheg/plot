import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { Schema } from "effect";
import { PlotApiError } from "./errors.js";
import { IssueEventLog } from "./schemas/orchestrator.js";

export class RefreshResult extends Schema.Class<RefreshResult>("RefreshResult")({
	queued: Schema.Boolean,
	coalesced: Schema.Boolean,
	requestedAt: Schema.DateTimeUtcFromString,
	operations: Schema.Array(Schema.String),
}) {}

export class PlotRpcs extends RpcGroup.make(
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
