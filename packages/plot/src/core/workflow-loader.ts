import { Duration, Effect, FileSystem, Layer, Ref, Schema, ServiceMap } from "effect";
import { WorkflowDefinition, WorkflowConfig } from "@plot/sdk";
import { WorkflowFileNotFound, WorkflowParseError } from "../schemas/errors.js";
import { extractFrontmatter } from "./workflow-parse.js";

export class WorkflowLoader extends ServiceMap.Service<WorkflowLoader>()("WorkflowLoader", {
	make: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const currentRef = yield* Ref.make<WorkflowDefinition | null>(null);
		const revisionRef = yield* Ref.make(0);
		const lastContentRef = yield* Ref.make<string | null>(null);

		const parseWorkflow = Effect.fnUntraced(function* (content: string) {
			const { configRaw, promptTemplate } = yield* Effect.try({
				try: () => extractFrontmatter(content),
				catch: (e) => new WorkflowParseError({ message: String(e) }),
			});

			const config = yield* Schema.decodeUnknownEffect(WorkflowConfig)(configRaw).pipe(
				Effect.mapError((e) => new WorkflowParseError({ message: `Config validation: ${e}` })),
			);

			return new WorkflowDefinition({ config, promptTemplate });
		});

		const load = Effect.fnUntraced(function* (path: string) {
			const exists = yield* fs
				.exists(path)
				.pipe(Effect.mapError(() => new WorkflowFileNotFound({ path })));
			if (!exists) {
				return yield* new WorkflowFileNotFound({ path });
			}

			const content = yield* fs
				.readFileString(path)
				.pipe(Effect.mapError(() => new WorkflowFileNotFound({ path })));

			const definition = yield* parseWorkflow(content);
			yield* Ref.set(currentRef, definition);
			yield* Ref.update(revisionRef, (n) => n + 1);
			yield* Ref.set(lastContentRef, content);
			return definition;
		});

		const startWatching = Effect.fnUntraced(function* (path: string) {
			const poll = Effect.gen(function* () {
				const content = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => null));
				if (content === null) return;

				const prev = yield* Ref.get(lastContentRef);
				if (content === prev) return;

				const result = yield* parseWorkflow(content).pipe(Effect.result);
				if (result._tag === "Success") {
					yield* Ref.set(currentRef, result.success);
					yield* Ref.update(revisionRef, (n) => n + 1);
					yield* Ref.set(lastContentRef, content);
				} else {
					yield* Effect.logError("workflow_reload_failed").pipe(
						Effect.annotateLogs("path", path),
						Effect.annotateLogs("error", String(result.failure)),
					);
				}
			});

			yield* poll
				.pipe(Effect.delay(Duration.seconds(5)), Effect.forever, Effect.forkScoped)
				.pipe(Effect.asVoid);
		});

		const getCurrent = Ref.get(currentRef);

		return { load, startWatching, getCurrent };
	}),
}) {
	static layer = Layer.effect(this, this.make);
}
