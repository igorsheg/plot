import { Duration, Effect, Queue, Schedule, Stream } from "effect";
import type { ProjectCommand } from "./project-command";

export const spawnProcess = (
	args: ReadonlyArray<string>,
	cwd: string,
) =>
	Effect.sync(() => {
		const proc = Bun.spawn([...args], {
			cwd,
			stdio: ["ignore", "ignore", "pipe"],
		});
		const stderr = proc.stderr as ReadableStream<Uint8Array> | null;
		if (stderr) stderr.pipeTo(new WritableStream()).catch(() => {});
		return proc;
	});

export const healthCheck = (port: number) =>
	Effect.tryPromise({
		try: () => fetch(`http://localhost:${port}/health`),
		catch: () => ({ _tag: "HealthNotReady" as const }),
	}).pipe(
		Effect.filterOrFail(
			(res) => res.ok,
			() => ({ _tag: "HealthNotReady" as const }),
		),
		Effect.asVoid,
	);

export const pollHealth = (port: number, mailbox: Queue.Queue<ProjectCommand>) =>
	healthCheck(port).pipe(
		Effect.retry(
			Schedule.both(
				Schedule.exponential(Duration.millis(300)),
				Schedule.recurs(30),
			),
		),
		Effect.matchEffect({
			onSuccess: () => Queue.offer(mailbox, { _tag: "health_ok" }),
			onFailure: () =>
				Queue.offer(mailbox, { _tag: "health_failed", error: "Health check timeout" }),
		}),
	);

export const connectSSE = (port: number, mailbox: Queue.Queue<ProjectCommand>) =>
	Effect.tryPromise({
		try: () => fetch(`http://localhost:${port}/events`),
		catch: () => new Error("SSE fetch failed"),
	}).pipe(
		Effect.flatMap((res) => {
			if (!res.body) return Effect.void;
			const body = res.body;
			return Stream.fromReadableStream({
				evaluate: () => body,
				onError: () => new Error("stream read error"),
			}).pipe(
				Stream.decodeText(),
				Stream.flatMap((chunk: string) => Stream.fromIterable(chunk.split("\n\n"))),
				Stream.filter((raw: string) => raw.length > 0),
				Stream.map((raw: string) => {
					const lines = raw.split("\n");
					let eventType = "";
					let data = "";
					for (const line of lines) {
						if (line.startsWith("event: ")) eventType = line.slice(7);
						else if (line.startsWith("data: ")) data = line.slice(6);
					}
					return { eventType, data };
				}),
				Stream.filter(({ eventType, data }: { eventType: string; data: string }) =>
					eventType === "snapshot" && data.length > 0,
				),
				Stream.mapEffect(({ data }: { data: string }) =>
					Effect.try({ try: () => JSON.parse(data) as unknown, catch: () => null }).pipe(
						Effect.flatMap((snapshot) =>
							snapshot !== null
								? Queue.offer(mailbox, { _tag: "snapshot", snapshot })
								: Effect.void,
						),
						Effect.catch(() => Effect.void),
					),
				),
				Stream.runDrain,
			);
		}),
		Effect.catch(() => Queue.offer(mailbox, { _tag: "sse_failed" })),
	);

export const watchExit = (
	proc: { exited: Promise<number> },
	mailbox: Queue.Queue<ProjectCommand>,
) =>
	Effect.tryPromise({
		try: () => proc.exited,
		catch: () => null,
	}).pipe(
		Effect.flatMap((code) =>
			Queue.offer(mailbox, { _tag: "exit", code: typeof code === "number" ? code : null }),
		),
	);
