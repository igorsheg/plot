import {
	Cache,
	Duration,
	Effect,
	Exit,
	FileSystem,
	Layer,
	Ref,
	Schema,
	ServiceMap,
} from "effect";
import matter from "gray-matter";
import { WorkflowDefinition, WorkflowConfig } from "@plot/sdk";
import { WorkflowFileNotFound, WorkflowParseError } from "./errors.js";

const snakeToCamel = (s: string): string =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const transformKeys = (obj: unknown): unknown => {
	if (Array.isArray(obj)) return obj.map(transformKeys);
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			result[snakeToCamel(k)] = transformKeys(v);
		}
		return result;
	}
	return obj;
};

interface RawFrontmatter {
	readonly configRaw: Record<string, unknown>;
	readonly promptTemplate: string;
}

export function extractFrontmatter(content: string): RawFrontmatter {
	const { data, content: promptBody } = matter(content);

	if (data === null || data === undefined) {
		return { configRaw: {}, promptTemplate: promptBody.trim() };
	}
	if (typeof data !== "object" || Array.isArray(data)) {
		throw new Error("Front matter must be a YAML map");
	}

	return {
		configRaw: transformKeys(data) as Record<string, unknown>,
		promptTemplate: promptBody.trim(),
	};
}



export class WorkflowLoader extends ServiceMap.Service<WorkflowLoader>()(
	"WorkflowLoader",
	{
		make: Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const currentRef = yield* Ref.make<WorkflowDefinition | null>(null);

			const parseWorkflow = Effect.fn(function* (content: string) {
				const { configRaw, promptTemplate } = yield* Effect.try({
					try: () => extractFrontmatter(content),
					catch: (e) => new WorkflowParseError({ message: String(e) }),
				});

				const config = yield* Schema.decodeUnknownEffect(WorkflowConfig)(
					configRaw,
				).pipe(
					Effect.mapError(
						(e) =>
							new WorkflowParseError({ message: `Config validation: ${e}` }),
					),
				);

				return new WorkflowDefinition({ config, promptTemplate });
			});

			const workflowCache = yield* Cache.makeWith({
				capacity: 4,
				lookup: (path: string) =>
					Effect.gen(function* () {
						const exists = yield* fs
							.exists(path)
							.pipe(Effect.mapError(() => new WorkflowFileNotFound({ path })));
						if (!exists) return yield* new WorkflowFileNotFound({ path });

						const content = yield* fs
							.readFileString(path)
							.pipe(Effect.mapError(() => new WorkflowFileNotFound({ path })));

						const definition = yield* parseWorkflow(content);
						yield* Ref.set(currentRef, definition);
						return definition;
					}),
				timeToLive: (exit) =>
					Exit.isSuccess(exit) ? Duration.seconds(5) : Duration.zero,
			});

			const load = Effect.fn(function* (path: string) {
				return yield* Cache.get(workflowCache, path);
			});

			const startWatching = Effect.fn(function* (path: string) {
				const poll = Effect.gen(function* () {
					yield* Cache.invalidate(workflowCache, path);
					yield* Cache.get(workflowCache, path).pipe(
						Effect.catch((e) =>
							Effect.logError("workflow_reload_failed").pipe(
								Effect.annotateLogs("path", path),
								Effect.annotateLogs("error", String(e)),
							),
						),
					);
				});

				yield* poll.pipe(
					Effect.delay(Duration.seconds(5)),
					Effect.forever,
					Effect.forkScoped,
					Effect.asVoid,
				);
			});

			const getCurrent = Ref.get(currentRef);

			return { load, startWatching, getCurrent };
		}),
	},
) {
	static layer = Layer.effect(this, this.make);
}
