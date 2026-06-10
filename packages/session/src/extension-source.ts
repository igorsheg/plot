import { pathToFileURL } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import { Effect, Schema } from "effect";
import {
	setFact,
	sourceId,
	subjectKey,
	workKey,
	type Completion,
	type SourceId,
	type WorkKey,
} from "@plot/agent/model";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { logWideEvent } from "@plot/common/observability";
import type { PlotPaths } from "./plot-paths.js";
import type { WorkflowDefinition } from "./workflow.js";
import type {
	MaybePromise,
	PlotExtension,
	PlotExtensionRuntime,
	PlotExtensionWork,
} from "./extension.js";

export class PlotExtensionSourceError extends Schema.TaggedErrorClass<PlotExtensionSourceError>()(
	"PlotExtensionSourceError",
	{
		phase: Schema.Literals(["load", "config", "create", "discover", "hook"]),
		message: Schema.String,
		source: Schema.optionalKey(Schema.String),
	},
) {}

export interface LoadedPlotExtensionRuntime {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
}

export interface PlotExtensionSourceBundle {
	readonly source: WorkSource;
	readonly wrapRunner: (runner: WorkRunner) => WorkRunner;
	readonly shutdown: () => Effect.Effect<void>;
}

const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

const runMaybePromise = <A>(
	phase: PlotExtensionSourceError["phase"],
	source: string | undefined,
	thunk: () => MaybePromise<A>,
) =>
	Effect.tryPromise({
		try: () => Promise.resolve(thunk()),
		catch: (error) =>
			new PlotExtensionSourceError({
				phase,
				message: errorMessage(error),
				...(source === undefined ? {} : { source }),
			}),
	});

const logHookError = (error: unknown, hook: string, source: SourceId) =>
	logWideEvent(
		{
			operation: "plot_extension.hook",
			outcome: "error",
			hook,
			source_id: source,
			error: errorMessage(error),
		},
		"error",
	);

const sanitizeIdentifier = (value: string): string => {
	const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "_");
	return sanitized.length === 0 ? "extension" : sanitized;
};

const sourceIdForExtension = (extension: PlotExtension): SourceId =>
	sourceId(`extension:${sanitizeIdentifier(extension.id)}`);

const workKeyForExtensionWork = (
	extension: PlotExtension,
	work: PlotExtensionWork,
): WorkKey =>
	workKey(
		`extension:${extension.id}:${work.id}:${work.version ?? "unversioned"}`,
	);

const completedFactKey = (key: WorkKey) => `extension.completed:${key}`;

const discoveredFactKey = (source: SourceId) =>
	`extension.discovered:${source}`;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const templateContextForWork = (
	workflow: WorkflowDefinition,
	work: PlotExtensionWork,
) => {
	const metadata = {
		id: work.id,
		...(work.version === undefined ? {} : { version: work.version }),
		...(work.title === undefined ? {} : { title: work.title }),
		...(work.url === undefined ? {} : { url: work.url }),
		...(work.subject === undefined ? {} : { subject: work.subject }),
	};
	const base = { workflow: workflow.config, work: metadata };
	if (work.context === undefined) return base;
	if (isObjectRecord(work.context)) return { ...base, ...work.context };
	return { ...base, value: work.context };
};

const toSubject = (work: PlotExtensionWork) =>
	subjectKey(work.subject ?? work.id);

const decodeDiscoveredWorks = (value: unknown): readonly PlotExtensionWork[] =>
	Array.isArray(value) ? (value as readonly PlotExtensionWork[]) : [];

const invokeCompletionHook = (
	runtime: PlotExtensionRuntime,
	source: SourceId,
	work: PlotExtensionWork,
	completion: Completion,
) => {
	const runId = String(completion.runId);
	if (completion.status === "succeeded") {
		return runtime.completed
			? runMaybePromise("hook", String(source), () =>
					runtime.completed?.({
						work,
						runId,
						...(completion.output === undefined
							? {}
							: { output: completion.output }),
					}),
				).pipe(
					Effect.catch((error) => logHookError(error, "completed", source)),
				)
			: Effect.void;
	}
	if (completion.status === "failed") {
		return runtime.failed
			? runMaybePromise("hook", String(source), () =>
					runtime.failed?.({
						work,
						runId,
						error: completion.error ?? completion.status,
					}),
				).pipe(Effect.catch((error) => logHookError(error, "failed", source)))
			: Effect.void;
	}
	if (completion.status === "timed_out") {
		return runtime.timedOut
			? runMaybePromise("hook", String(source), () =>
					runtime.timedOut?.({ work, runId }),
				).pipe(Effect.catch((error) => logHookError(error, "timedOut", source)))
			: Effect.void;
	}
	return runtime.interrupted
		? runMaybePromise("hook", String(source), () =>
				runtime.interrupted?.({ work, runId }),
			).pipe(
				Effect.catch((error) => logHookError(error, "interrupted", source)),
			)
		: Effect.void;
};

export const makePlotExtensionSourceBundle = (options: {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly workflow: WorkflowDefinition;
}): PlotExtensionSourceBundle => {
	const source = sourceIdForExtension(options.extension);
	const selectedWork = new Map<WorkKey, PlotExtensionWork>();

	const workSource: WorkSource = {
		id: source,
		observeTick: () =>
			runMaybePromise("discover", String(source), () =>
				options.runtime.discover(),
			).pipe(
				Effect.map((works) => [
					{
						type: "plot.extension.discovered",
						subject: subjectKey(String(source)),
						data: [...works],
					},
				]),
			),
		reconcile: ({ snapshot }) =>
			Effect.gen(function* () {
				const proposals = [];
				const latestDiscovery = snapshot.observations.findLast(
					(observation) =>
						observation.type === "plot.extension.discovered" &&
						observation.subject === String(source),
				);
				if (latestDiscovery !== undefined) {
					proposals.push(
						setFact(
							discoveredFactKey(source),
							decodeDiscoveredWorks(latestDiscovery.data),
						),
					);
				}
				for (const completion of snapshot.completions) {
					if (completion.sourceId !== source) continue;
					const work = selectedWork.get(completion.workKey);
					if (work === undefined) continue;
					yield* invokeCompletionHook(
						options.runtime,
						source,
						work,
						completion,
					);
					proposals.push(
						setFact(completedFactKey(completion.workKey), {
							status: completion.status,
							...(completion.output === undefined
								? {}
								: { output: completion.output }),
							...(completion.error === undefined
								? {}
								: { error: completion.error }),
						}),
					);
				}
				return proposals;
			}),
		selectWork: ({ snapshot }) => {
			const works = decodeDiscoveredWorks(
				snapshot.facts.get(discoveredFactKey(source)),
			);
			return Effect.succeed(
				works.flatMap((extensionWork) => {
					const key = workKeyForExtensionWork(options.extension, extensionWork);
					if (snapshot.running.has(key)) return [];
					if (snapshot.facts.has(completedFactKey(key))) return [];
					selectedWork.set(key, extensionWork);
					return [
						{
							workKey: key,
							subject: toSubject(extensionWork),
							templateContext: templateContextForWork(
								options.workflow,
								extensionWork,
							),
						},
					];
				}),
			);
		},
	};

	return {
		source: workSource,
		wrapRunner: (runner) => ({
			run: (context: WorkRunnerContext) => {
				const work = selectedWork.get(context.work.workKey);
				const started =
					work === undefined || options.runtime.started === undefined
						? Effect.void
						: runMaybePromise("hook", String(source), () =>
								options.runtime.started?.({
									work,
									runId: String(context.run.runId),
								}),
							).pipe(
								Effect.catch((error) => logHookError(error, "started", source)),
							);
				return started.pipe(Effect.andThen(runner.run(context)));
			},
		}),
		shutdown: () =>
			options.runtime.shutdown === undefined
				? Effect.void
				: runMaybePromise("hook", String(source), () =>
						options.runtime.shutdown?.(),
					).pipe(
						Effect.catch((error) => logHookError(error, "shutdown", source)),
					),
	};
};

const getModuleExtension = (module: unknown): PlotExtension | undefined => {
	if (!isObjectRecord(module)) return undefined;
	const candidate = module["default"] ?? module["extension"];
	if (!isObjectRecord(candidate)) return undefined;
	if (typeof candidate["id"] !== "string") return undefined;
	if (typeof candidate["create"] !== "function") return undefined;
	return candidate as unknown as PlotExtension;
};

const resolveExtensionSourcePath = (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
	readonly source: string;
}) => {
	if (isAbsolute(options.source)) return options.source;
	const base =
		options.workflow.path === undefined
			? options.paths.cwd
			: dirname(options.workflow.path);
	return resolve(base, options.source);
};

export const loadPlotExtensionRuntimeFromWorkflow = (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
}): Effect.Effect<LoadedPlotExtensionRuntime, PlotExtensionSourceError> =>
	Effect.gen(function* () {
		const extensionConfig = options.workflow.runtime.extension;
		if (extensionConfig === undefined) {
			return yield* new PlotExtensionSourceError({
				phase: "load",
				message: "workflow does not configure an extension source",
			});
		}
		const source = resolveExtensionSourcePath({
			workflow: options.workflow,
			paths: options.paths,
			source: extensionConfig.source,
		});
		const module = yield* Effect.tryPromise({
			try: () => import(pathToFileURL(source).href),
			catch: (error) =>
				new PlotExtensionSourceError({
					phase: "load",
					source,
					message: errorMessage(error),
				}),
		});
		const extension = getModuleExtension(module);
		if (extension === undefined) {
			return yield* new PlotExtensionSourceError({
				phase: "load",
				source,
				message:
					"extension module must export a PlotExtension as default or extension",
			});
		}
		const config = extension.parseConfig
			? yield* runMaybePromise("config", source, () =>
					extension.parseConfig?.(extensionConfig.config),
				)
			: extensionConfig.config;
		const runtime = yield* runMaybePromise("create", source, () =>
			extension.create({
				config,
				workflow: options.workflow,
				paths: options.paths,
				work: (input) => input,
			}),
		);
		return { extension, runtime };
	});

export const makePlotExtensionSourceBundleFromWorkflow = (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
}): Effect.Effect<PlotExtensionSourceBundle, PlotExtensionSourceError> =>
	loadPlotExtensionRuntimeFromWorkflow(options).pipe(
		Effect.map(({ extension, runtime }) =>
			makePlotExtensionSourceBundle({
				extension,
				runtime,
				workflow: options.workflow,
			}),
		),
	);
