import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { IssueDetail, RuntimeSnapshot } from "./schemas/orchestrator.js";

export class RefreshResult extends Schema.Class<RefreshResult>("RefreshResult")(
	{
		queued: Schema.Boolean,
		coalesced: Schema.Boolean,
		requestedAt: Schema.DateTimeUtc,
		operations: Schema.Array(Schema.String),
	},
) {}

export class PlotRpcs extends RpcGroup.make(
	Rpc.make("GetState", {
		success: RuntimeSnapshot,
		error: Schema.String,
	}),
	Rpc.make("GetIssue", {
		success: IssueDetail,
		error: Schema.String,
		payload: { identifier: Schema.String },
	}),
	Rpc.make("TriggerRefresh", {
		success: RefreshResult,
		error: Schema.String,
	}),
) {}
