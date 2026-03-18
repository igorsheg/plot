import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { Schema } from "effect";
import { PlotApiError } from "./errors.js";
import {
	IssueDetail,
	IssueEventLog,
	RuntimeSnapshot,
} from "./schemas/orchestrator.js";
import { AgentRuntimeEvent } from "./schemas/events.js";

export class RefreshResult extends Schema.Class<RefreshResult>("RefreshResult")(
	{
		queued: Schema.Boolean,
		coalesced: Schema.Boolean,
		requestedAt: Schema.DateTimeUtcFromString,
		operations: Schema.Array(Schema.String),
	},
) {}

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
	Rpc.make("Events", {
		success: AgentRuntimeEvent,
		error: PlotApiError,
		stream: true,
	}),
) {}
