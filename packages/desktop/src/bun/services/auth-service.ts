import { Effect, Layer, PubSub, Ref, ServiceMap, Stream } from "effect";
import { BinaryResolver } from "./binary-resolver";
import { AuthError } from "./errors";
import type { AuthState, ProviderInfo } from "../../shared/rpc";
import { Utils } from "electrobun/bun";

type ActiveAuth = {
	readonly proc: ReturnType<typeof Bun.spawn>;
};

export class AuthService extends ServiceMap.Service<AuthService>()("AuthService", {
	make: Effect.gen(function* () {
		const binary = yield* BinaryResolver;
		const statePubSub = yield* PubSub.bounded<AuthState>(64);
		const activeRef = yield* Ref.make<ActiveAuth | null>(null);

		const publishState = (state: AuthState) => PubSub.publish(statePubSub, state);

		const getProviders: Effect.Effect<ReadonlyArray<ProviderInfo>, AuthError> =
			Effect.gen(function* () {
				const args = yield* binary.resolveArgs;
				return yield* Effect.tryPromise({
					try: async () => {
						const proc = Bun.spawn([...args, "models", "--all"], {
							stdio: ["ignore", "pipe", "ignore"],
						});
						const text = await new Response(proc.stdout).text();
						await proc.exited;
						const envelope = JSON.parse(text.trim().split("\n").pop() ?? "{}");
						if (!envelope.ok) return [];
						return (envelope.result?.providers ?? []).map(
							(p: {
								id: string;
								authenticated: boolean;
								models: Array<{
									id: string;
									name: string;
									provider: string;
									reasoning?: boolean;
									contextWindow?: number;
									maxTokens?: number;
								}>;
							}) => ({
								id: p.id,
								authenticated: p.authenticated,
								modelCount: p.models?.length ?? 0,
								models: (p.models ?? []).map((m) => ({
									id: m.id,
									name: m.name,
									provider: m.provider,
									reasoning: m.reasoning ?? false,
									contextWindow: m.contextWindow ?? 0,
									maxTokens: m.maxTokens ?? 0,
								})),
							}),
						);
					},
					catch: (e) => new AuthError({ code: "models_failed", message: String(e) }),
				});
			});

		const getAuthStatus: Effect.Effect<
			ReadonlyArray<{ id: string; name: string; authenticated: boolean }>,
			AuthError
		> = Effect.gen(function* () {
			const args = yield* binary.resolveArgs;
			return yield* Effect.tryPromise({
				try: async () => {
					const proc = Bun.spawn([...args, "auth", "status"], {
						stdio: ["ignore", "pipe", "ignore"],
					});
					const text = await new Response(proc.stdout).text();
					await proc.exited;
					const envelope = JSON.parse(text.trim().split("\n").pop() ?? "{}");
					if (!envelope.ok) return [];
					return envelope.result?.providers ?? [];
				},
				catch: (e) => new AuthError({ code: "auth_status_failed", message: String(e) }),
			});
		});

		const startLogin = (providerId: string) =>
			Effect.gen(function* () {
				const active = yield* Ref.get(activeRef);
				if (active && !active.proc.killed) {
					yield* Effect.sync(() => active.proc.kill());
				}

				const args = yield* binary.resolveArgs;
				yield* publishState({ phase: "authenticating" });

				yield* Effect.tryPromise({
					try: async () => {
						const proc = Bun.spawn([...args, "auth", "login", providerId], {
							stdio: ["pipe", "pipe", "ignore"],
						});

						await Effect.runPromise(Ref.set(activeRef, { proc }));

						const stdout = proc.stdout;
						if (!stdout) return;

						const reader = (stdout as ReadableStream<Uint8Array>).getReader();
						const decoder = new TextDecoder();
						let buffer = "";

						while (true) {
							const { done, value } = await reader.read();
							if (done) break;

							buffer += decoder.decode(value, { stream: true });
							const lines = buffer.split("\n");
							buffer = lines.pop() ?? "";

							for (const line of lines) {
								if (!line.trim()) continue;
								try {
									const msg = JSON.parse(line);
									switch (msg.type) {
										case "auth:url":
											Utils.openExternal(msg.url);
											await Effect.runPromise(publishState({ phase: "authenticating" }));
											break;
										case "auth:prompt":
											await Effect.runPromise(
												publishState({
													phase: "waitingForCode",
													message: msg.message,
													placeholder: msg.placeholder,
												}),
											);
											break;
										case "result":
											if (msg.ok) {
												await Effect.runPromise(publishState({ phase: "success" }));
											}
											break;
										case "error":
											await Effect.runPromise(
												publishState({
													phase: "failed",
													error: msg.error?.message ?? "Auth failed",
												}),
											);
											break;
									}
								} catch {
									// skip malformed NDJSON
								}
							}
						}

						await proc.exited;
						await Effect.runPromise(Ref.set(activeRef, null));
					},
					catch: (e) => new AuthError({ code: "login_failed", message: String(e) }),
				});
			});

		const submitResponse = (value: string) =>
			Effect.gen(function* () {
				const active = yield* Ref.get(activeRef);
				if (!active) return;
				const stdin = active.proc.stdin;
				if (!stdin || typeof stdin === "number") return;
				yield* Effect.sync(() => {
					stdin.write(JSON.stringify({ type: "response", value }) + "\n");
				});
			});

		const stateStream = Stream.fromPubSub(statePubSub);

		return { getProviders, getAuthStatus, startLogin, submitResponse, stateStream };
	}),
}) {
	static layer = Layer.effect(this, this.make).pipe(Layer.provide(BinaryResolver.layer));
}
