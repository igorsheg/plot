import { Effect, Layer, PubSub, Ref, ServiceMap, Stream } from "effect";
import { join as joinPath } from "node:path";
import { homedir } from "node:os";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import { getCatalogProviders } from "@plot/sdk";
import { Platform } from "./platform";
import { AuthError } from "./errors";
import type { AuthState, ProviderInfo } from "../../shared/rpc";

function getPlotAuthPath(): string {
	const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? homedir();
	return joinPath(home, ".plot", "agent", "auth.json");
}

type PendingPrompt = {
	readonly providerId: string;
	readonly resolve: (value: string) => void;
	readonly reject: (reason: Error) => void;
	readonly abortController: AbortController;
};

export class AuthService extends ServiceMap.Service<AuthService>()("AuthService", {
	make: Effect.gen(function* () {
		const platform = yield* Platform;
		const statePubSub = yield* PubSub.bounded<AuthState>(64);
		const pendingRef = yield* Ref.make<PendingPrompt | null>(null);

		const authStorage = AuthStorage.create(getPlotAuthPath());

		const publishState = (state: AuthState) => PubSub.publish(statePubSub, state);

		const oauthProviderIds = new Set(
			authStorage.getOAuthProviders().map((p) => p.id),
		);

		const getProviders: Effect.Effect<ReadonlyArray<ProviderInfo>, AuthError> =
			Effect.gen(function* () {
				const catalog = yield* Effect.try({
					try: () => getCatalogProviders(),
					catch: (e) => new AuthError({ code: "catalog_failed", message: String(e) }),
				});

				// Reload to get fresh auth state
				yield* Effect.sync(() => authStorage.reload());

				const oauthProviders = authStorage.getOAuthProviders();
				const oauthMap = new Map(oauthProviders.map((p) => [p.id, p.name]));

				const result = catalog.map((p) => ({
					id: p.id,
					name: oauthMap.get(p.id) ?? p.id,
					authenticated: authStorage.has(p.id),
					authMode: (oauthProviderIds.has(p.id) ? "oauth" : "api_key") as "oauth" | "api_key",
					modelCount: p.modelCount,
					models: p.models.map((m) => ({
						id: m.id,
						name: m.name,
						provider: m.provider,
						reasoning: m.reasoning,
						contextWindow: m.contextWindow,
						maxTokens: m.maxTokens,
					})),
				}));
				return result;
			});

		const clearPending = (reason?: string) =>
			Effect.gen(function* () {
				const pending = yield* Ref.get(pendingRef);
				if (pending) {
					pending.abortController.abort();
					pending.reject(new Error(reason ?? "cancelled"));
					yield* Ref.set(pendingRef, null);
				}
			});

		const startLogin = (providerId: string) =>
			Effect.gen(function* () {
				// Cancel any in-flight login
				yield* clearPending("replaced by new login");

				const abortController = new AbortController();

				yield* publishState({ phase: "authenticating", providerId });

				const callbacks: OAuthLoginCallbacks = {
					onAuth: ({ url }) => {
						Effect.runFork(
							platform.openExternal(url).pipe(
								Effect.andThen(publishState({ phase: "authenticating", providerId })),
							),
						);
					},
					onPrompt: ({ message, placeholder, allowEmpty }) => {
						return new Promise<string>((resolve, reject) => {
							Effect.runFork(
								Effect.gen(function* () {
									yield* Ref.set(pendingRef, { providerId, resolve, reject, abortController });
									yield* publishState({
										phase: "waitingForCode",
										providerId,
										message,
										placeholder,
									});
								}),
							);
						});
					},
					onManualCodeInput: () => {
						return new Promise<string>((resolve, reject) => {
							Effect.runFork(
								Effect.gen(function* () {
									yield* Ref.set(pendingRef, { providerId, resolve, reject, abortController });
									yield* publishState({
										phase: "waitingForCode",
										providerId,
										message: "Paste authorization code",
									});
								}),
							);
						});
					},
					onProgress: () => {},
					signal: abortController.signal,
				};

				yield* Effect.tryPromise({
					try: () => authStorage.login(providerId, callbacks),
					catch: (e) => new AuthError({ code: "login_failed", message: e instanceof Error ? e.message : String(e) }),
				}).pipe(
					Effect.tap(() =>
						Effect.gen(function* () {
							yield* Ref.set(pendingRef, null);
							yield* publishState({ phase: "success", providerId });
						}),
					),
					Effect.catch((e) =>
						Effect.gen(function* () {
							yield* Ref.set(pendingRef, null);
							yield* publishState({
								phase: "failed",
								providerId,
								error: e.message,
							});
						}),
					),
				);
			});

		const submitResponse = (value: string) =>
			Effect.gen(function* () {
				const pending = yield* Ref.get(pendingRef);
				if (!pending) return;
				pending.resolve(value);
				yield* Ref.set(pendingRef, null);
			});

		const saveApiKey = (providerId: string, key: string) =>
			Effect.gen(function* () {
				yield* Effect.try({
					try: () => authStorage.set(providerId, { type: "api_key", key }),
					catch: (e) => new AuthError({ code: "save_key_failed", message: String(e) }),
				});
				yield* publishState({ phase: "success", providerId });
			});

		const removeApiKey = (providerId: string) =>
			Effect.gen(function* () {
				yield* Effect.try({
					try: () => authStorage.remove(providerId),
					catch: (e) => new AuthError({ code: "remove_key_failed", message: String(e) }),
				});
				yield* publishState({ phase: "idle", providerId: null });
			});

		const stateStream = Stream.fromPubSub(statePubSub);

		const dispose = clearPending("shutdown");

		return {
			getProviders,
			startLogin,
			submitResponse,
			saveApiKey,
			removeApiKey,
			stateStream,
			dispose,
		};
	}),
}) {
	static layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Platform.layer),
	);
}
