import { Effect } from "effect";
import { PlotRpcs } from "@plot/sdk";
import { Orchestrator } from "./core/index.js";

export const RpcHandlersLive = PlotRpcs.toLayer(
	Effect.gen(function* () {
		const orchestrator = yield* Orchestrator;

		return {
			GetEventLog: ({ identifier }) => orchestrator.getEventLog(identifier),
			TriggerRefresh: () => orchestrator.triggerRefresh,
		};
	}),
);
