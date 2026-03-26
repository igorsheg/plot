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

		const handleNdjsonMessage = (msg: { type?: string; url?: string; message?: string; placeholder?: string; ok?: boolean; error?: { message?: string } }) => {
			switch (msg.type) {
				case "auth:url":
					return Effect.sync(() => Utils.openExternal(msg.url ?? "")).pipe(
						Effect.andThen(publishState({ phase: "authenticating" })),
					);
				case "auth:prompt":
					return publishState({
						phase: "waitingForCode",
						message: msg.message ?? "",
						placeholder: msg.placeholder,
					});
				case "result":
					return msg.ok ? publishState({ phase: "success" }) : Effect.void;
				case "error":
					return publishState({
						phase: "failed",
						error: msg.error?.message ?? "Auth failed",
					});
				default:
					return Effect.void;
			}
		};

		const startLogin = (providerId: string) =>
			Effect.gen(function* () {
				const active = yield* Ref.get(activeRef);
				if (active && !active.proc.killed) {
					yield* Effect.sync(() => active.proc.kill());
				}

				const args = yield* binary.resolveArgs;
				yield* publishState({ phase: "authenticating" });

				const proc = yield* Effect.sync(() =>
					Bun.spawn([...args, "auth", "login", providerId], {
						stdio: ["pipe", "pipe", "ignore"],
					}),
				);

				yield* Ref.set(activeRef, { proc });

				const stdout = proc.stdout as ReadableStream<Uint8Array> | null;
				if (!stdout) return;

				yield* Stream.fromReadableStream({
					evaluate: () => stdout,
					onError: () => new AuthError({ code: "login_stream_failed", message: "stdout read error" }),
				}).pipe(
					Stream.decodeText(),
					Stream.flatMap((chunk: string) => Stream.fromIterable(chunk.split("\n"))),
					Stream.filter((line: string) => line.trim().length > 0),
					Stream.mapEffect((line: string) =>
						Effect.try({ try: () => JSON.parse(line), catch: () => null }).pipe(
							Effect.flatMap((parsed) =>
								parsed !== null ? handleNdjsonMessage(parsed) : Effect.void,
							),
						),
					),
					Stream.runDrain,
					Effect.ensuring(Ref.set(activeRef, null)),
					Effect.catch(() => publishState({ phase: "failed", error: "Auth stream failed" })),
				);

				yield* Effect.tryPromise({
					try: () => proc.exited,
					catch: () => new AuthError({ code: "login_failed", message: "Process exited unexpectedly" }),
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
