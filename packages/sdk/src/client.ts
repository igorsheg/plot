import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Effect, Layer, ManagedRuntime } from "effect";
import type {
	IssueDetail,
	IssueEventLog,
	RuntimeSnapshot,
} from "./schemas/orchestrator.js";
import { PlotRpcs, type RefreshResult } from "./rpc.js";

export const makePlotClient = (baseUrl: string) => {
	const ProtocolLive = RpcClient.layerProtocolHttp({ url: baseUrl }).pipe(
		Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson]),
	);

	const runtime = ManagedRuntime.make(ProtocolLive);

	const run = <A, E>(
		effect: Effect.Effect<A, E, RpcClient.Protocol>,
	): Promise<A> => runtime.runPromise(effect);

	const clientEffect = RpcClient.make(PlotRpcs);

	return {
		getState: (): Promise<RuntimeSnapshot> =>
			run(
				Effect.scoped(
					Effect.flatMap(clientEffect, (client) => client.GetState()),
				),
			),
		getIssue: (identifier: string): Promise<IssueDetail> =>
			run(
				Effect.scoped(
					Effect.flatMap(clientEffect, (client) =>
						client.GetIssue({ identifier }),
					),
				),
			),
		getEventLog: (identifier: string): Promise<IssueEventLog> =>
			run(
				Effect.scoped(
					Effect.flatMap(clientEffect, (client) =>
						client.GetEventLog({ identifier }),
					),
				),
			),
		triggerRefresh: (): Promise<RefreshResult> =>
			run(
				Effect.scoped(
					Effect.flatMap(clientEffect, (client) => client.TriggerRefresh()),
				),
			),
	};
};
