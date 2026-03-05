import {
  type DefaultError,
  type QueryFunctionContext,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import type * as Effect from "effect/Effect";

export type RunEffectPromise<R> = <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;

export interface UseEffectQueryOptions<
  TQueryFnData,
  TError,
  TData,
  TQueryKey extends QueryKey,
  R,
> extends Omit<UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>, "queryFn"> {
  queryFn: (
    signal: AbortSignal,
    context: QueryFunctionContext<TQueryKey>,
  ) => Effect.Effect<TQueryFnData, TError, R>;
}

export interface UseEffectMutationOptions<
  TData,
  TError,
  TVariables,
  TOnMutateResult,
  R,
> extends Omit<UseMutationOptions<TData, TError, TVariables, TOnMutateResult>, "mutationFn"> {
  mutationFn: (variables: TVariables) => Effect.Effect<TData, TError, R>;
}

export function makeUseEffectQuery<R>(runEffect: RunEffectPromise<R>) {
  return function useEffectQuery<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    options: UseEffectQueryOptions<TQueryFnData, TError, TData, TQueryKey, R>,
  ): UseQueryResult<TData, TError> {
    return useQuery({
      ...options,
      queryFn: (context) => runEffect(options.queryFn(context.signal, context)),
    });
  };
}

export function makeUseEffectMutation<R>(runEffect: RunEffectPromise<R>) {
  return function useEffectMutation<
    TData = unknown,
    TError = DefaultError,
    TVariables = void,
    TOnMutateResult = unknown,
  >(
    options: UseEffectMutationOptions<TData, TError, TVariables, TOnMutateResult, R>,
  ): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
    return useMutation({
      ...options,
      mutationFn: (variables) => runEffect(options.mutationFn(variables)),
    });
  };
}
