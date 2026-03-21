import { Effect } from "effect";
import { PlotRpcs } from "@plot/sdk";
import { ObservabilityApi } from "./observability-service.js";

export const RpcHandlersLive = PlotRpcs.toLayer(
	Effect.gen(function* () {
		const api = yield* ObservabilityApi;

		return {
			GetEventLog: ({ identifier }) => api.getEventLog(identifier),
			TriggerRefresh: () => api.triggerRefresh,
		};
	}),
);
