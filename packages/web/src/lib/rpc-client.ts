import { FetchHttpClient } from "@effect/platform";
import { RpcClient, RpcSerialization } from "@effect/rpc";
import { Effect, Layer, ManagedRuntime } from "effect";
import { PlotRpcs } from "@plot/shared";
import { makeUseEffectQuery, makeUseEffectMutation } from "@/lib/effect-query";

const ProtocolLive = RpcClient.layerProtocolHttp({
  url: "/rpc",
}).pipe(Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson]));

const ClientLive = Layer.mergeAll(ProtocolLive);

const runtime = ManagedRuntime.make(ClientLive);

const runEffect: <A, E>(effect: Effect.Effect<A, E, RpcClient.Protocol>) => Promise<A> = (effect) =>
  runtime.runPromise(effect as Effect.Effect<never, never, RpcClient.Protocol>);

export const useEffectQuery = makeUseEffectQuery(runEffect as never);
export const useEffectMutation = makeUseEffectMutation(runEffect as never);

export const useRpcClient = () => {
  const clientEffect = RpcClient.make(PlotRpcs);
  return {
    getState: () => Effect.scoped(Effect.flatMap(clientEffect, (client) => client.GetState())),
    getIssue: (identifier: string) =>
      Effect.scoped(Effect.flatMap(clientEffect, (client) => client.GetIssue({ identifier }))),
    triggerRefresh: () =>
      Effect.scoped(Effect.flatMap(clientEffect, (client) => client.TriggerRefresh())),
  };
};
