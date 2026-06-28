import { createJiti } from "jiti/static";
import { dirname, isAbsolute, resolve } from "node:path";
import {
	interruptWork,
	removeWork,
	setFact,
	sourceId,
	subjectKey,
	upsertWork,
	workKey,
	type Completion,
	type SourceId,
	type WorkKey,
	type WorkRecord,
} from "@plot/agent/model";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { logWideEvent } from "@plot/common/observability";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
	MaybePromise,
	PlotExtension,
	PlotExtensionRuntime,
	PlotExtensionTool,
	PlotExtensionWork,
	PlotJsonSchema,
	PlotToolContext,
	PlotToolDefinition,
} from "./sdk.js";
import * as plotSdk from "./sdk.js";
import { z } from "zod";
import type { SessionPaths } from "./paths.js";
import { errorMessage } from "./primitives.js";
import type { WorkflowDefinition } from "./workflow.js";

export class PlotExtensionSourceError extends Error {
	override readonly name = "PlotExtensionSourceError";
	readonly phase: "load" | "config" | "create" | "discover" | "hook";
	readonly source?: string;

	constructor(input: {
		readonly phase: PlotExtensionSourceError["phase"];
		readonly message: string;
		readonly source?: string;
	}) {
		super(input.message);
		this.phase = input.phase;
		if (input.source !== undefined) this.source = input.source;
	}
}

export interface LoadedPlotExtensionRuntime {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly tools: readonly PlotExtensionTool[];
	readonly config: unknown;
}

export interface PlotExtensionSourceBundle {
	readonly source: WorkSource;
	readonly createOptions: (
		context: WorkRunnerContext,
	) => Promise<{ readonly customTools: ToolDefinition[] }>;
	readonly workFor: (
		context: WorkRunnerContext,
	) => PlotExtensionWork | undefined;
	readonly wrapRunner: (runner: WorkRunner) => WorkRunner;
	readonly shutdown: () => Promise<void>;
}

const displaySchema = z
	.object({
		kind: z.string().optional(),
		primary: z.string().optional(),
		title: z.string().optional(),
		subtitle: z.string().optional(),
		url: z.string().optional(),
		version: z.string().optional(),
		labels: z.array(z.string()).optional(),
	})
	.strict();

const operatorActionSchema = z
	.object({
		id: z.string().min(1),
		label: z.string().min(1),
		tone: z.enum(["primary", "secondary", "danger"]).optional(),
		disabledReason: z.string().optional(),
		requiresComment: z.boolean().optional(),
		confirm: z
			.object({ title: z.string().min(1), message: z.string().optional() })
			.strict()
			.optional(),
	})
	.strict();

const extensionWorkSchema = z
	.object({
		id: z.string().min(1),
		version: z.string().optional(),
		title: z.string().optional(),
		url: z.string().optional(),
		subject: z.string().optional(),
		status: z.enum(["pending", "blocked"]).optional(),
		blockedReason: z.string().optional(),
		display: displaySchema.optional(),
		operatorActions: z.array(operatorActionSchema).optional(),
		context: z.unknown().optional(),
	})
	.strict();

const extensionWorkListSchema = z.array(extensionWorkSchema);
type ParsedExtensionWork = z.infer<typeof extensionWorkSchema>;
type ParsedDisplay = z.infer<typeof displaySchema>;
type ParsedOperatorAction = z.infer<typeof operatorActionSchema>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const cleanDisplay = (
	display: ParsedDisplay,
): NonNullable<PlotExtensionWork["display"]> => {
	const clean: Mutable<NonNullable<PlotExtensionWork["display"]>> = {};
	for (const key of [
		"kind",
		"primary",
		"title",
		"subtitle",
		"url",
		"version",
	] as const) {
		const value = display[key];
		if (value !== undefined) clean[key] = value;
	}
	if (display.labels !== undefined) clean.labels = display.labels;
	return clean;
};

const cleanOperatorAction = (
	action: ParsedOperatorAction,
): NonNullable<PlotExtensionWork["operatorActions"]>[number] => {
	const clean: Mutable<
		NonNullable<PlotExtensionWork["operatorActions"]>[number]
	> = {
		id: action.id,
		label: action.label,
	};
	if (action.tone !== undefined) clean.tone = action.tone;
	if (action.disabledReason !== undefined)
		clean.disabledReason = action.disabledReason;
	if (action.requiresComment !== undefined)
		clean.requiresComment = action.requiresComment;
	if (action.confirm !== undefined) {
		const confirm: Mutable<NonNullable<typeof clean.confirm>> = {
			title: action.confirm.title,
		};
		if (action.confirm.message !== undefined)
			confirm.message = action.confirm.message;
		clean.confirm = confirm;
	}
	return clean;
};

const cleanWork = (work: ParsedExtensionWork): PlotExtensionWork => {
	const clean: Mutable<PlotExtensionWork> = { id: work.id };
	for (const key of [
		"version",
		"title",
		"url",
		"subject",
		"blockedReason",
	] as const) {
		const value = work[key];
		if (value !== undefined) clean[key] = value;
	}
	if (work.status !== undefined) clean.status = work.status;
	if (work.display !== undefined) clean.display = cleanDisplay(work.display);
	if (work.operatorActions !== undefined)
		clean.operatorActions = work.operatorActions.map(cleanOperatorAction);
	if (work.context !== undefined) clean.context = work.context;
	return clean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const runMaybePromise = async <A>(
	phase: PlotExtensionSourceError["phase"],
	source: string | undefined,
	thunk: () => MaybePromise<A>,
): Promise<A> => {
	try {
		return await Promise.resolve(thunk());
	} catch (error) {
		throw new PlotExtensionSourceError({
			phase,
			message: errorMessage(error),
			...(source === undefined ? {} : { source }),
		});
	}
};

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

const discoveredFactKey = (source: SourceId) =>
	`extension.discovered:${source}`;
const releasedReason = (source: SourceId) =>
	`work is no longer discovered by source ${source}`;
const isBlocked = (work: PlotExtensionWork) => work.status === "blocked";
const toSubject = (work: PlotExtensionWork) =>
	subjectKey(work.subject ?? work.id);

const decodeDiscoveredWorks = (
	value: unknown,
	source: string | undefined,
): readonly PlotExtensionWork[] => {
	try {
		return extensionWorkListSchema.parse(value).map(cleanWork);
	} catch (error) {
		throw new PlotExtensionSourceError({
			phase: "discover",
			message: errorMessage(error),
			...(source === undefined ? {} : { source }),
		});
	}
};

const decodeStoredWorks = (value: unknown): readonly PlotExtensionWork[] =>
	value === undefined ? [] : decodeDiscoveredWorks(value, undefined);

const workRecordFor = (
	extension: PlotExtension,
	source: SourceId,
	work: PlotExtensionWork,
	status: WorkRecord["status"],
	currentRunId?: string,
): WorkRecord => {
	const record: Mutable<WorkRecord> = {
		workKey: workKeyForExtensionWork(extension, work),
		sourceId: source,
		status,
		subject: toSubject(work),
	};
	if (work.display !== undefined) record.display = work.display;
	if (work.blockedReason !== undefined)
		record.blockedReason = work.blockedReason;
	if (work.operatorActions !== undefined)
		record.operatorActions = work.operatorActions;
	if (currentRunId !== undefined) record.currentRunId = currentRunId;
	return record;
};

const currentWorkKeys = (
	extension: PlotExtension,
	works: readonly PlotExtensionWork[],
): ReadonlySet<WorkKey> =>
	new Set(works.map((work) => workKeyForExtensionWork(extension, work)));

const templateContextForWork = (
	workflow: WorkflowDefinition,
	work: PlotExtensionWork,
) => {
	const metadata: Record<string, unknown> & { readonly id: string } = {
		id: work.id,
	};
	for (const key of ["version", "title", "url", "subject"] as const) {
		const value = work[key];
		if (value !== undefined) metadata[key] = value;
	}
	if (work.display !== undefined) metadata["display"] = work.display;
	if (work.operatorActions !== undefined)
		metadata["operatorActions"] = work.operatorActions;
	const base = { workflow: workflow.config, work: metadata };
	if (work.context === undefined) return base;
	if (isRecord(work.context)) return { ...base, ...work.context };
	return { ...base, value: work.context };
};

const discover = async (input: {
	readonly runtime: PlotExtensionRuntime;
	readonly source: SourceId;
	readonly signal: AbortSignal;
}): Promise<readonly PlotExtensionWork[]> =>
	decodeDiscoveredWorks(
		await runMaybePromise("discover", String(input.source), () =>
			input.runtime.discover({ signal: input.signal }),
		),
		String(input.source),
	);

const normalizeToolArguments = (
	schema: PlotJsonSchema,
	value: unknown,
): unknown => {
	if (schema.type === "object") {
		const normalized: Record<string, unknown> = {};
		if (!isRecord(value)) return normalized;
		for (const [key, propertySchema] of Object.entries(
			schema.properties ?? {},
		)) {
			if (value[key] !== undefined)
				normalized[key] = normalizeToolArguments(propertySchema, value[key]);
		}
		return normalized;
	}
	if (schema.type === "array" && Array.isArray(value)) {
		if (schema.items === undefined) return value;
		return value.map((item) => normalizeToolArguments(schema.items!, item));
	}
	return value;
};

const toPiToolDefinition = (
	tool: PlotToolDefinition,
): ToolDefinition<never, unknown> => ({
	name: tool.name,
	label: tool.label,
	description: tool.description,
	parameters: tool.parameters as never,
	prepareArguments: (args) =>
		normalizeToolArguments(tool.parameters, args) as never,
	...(tool.promptSnippet === undefined
		? {}
		: { promptSnippet: tool.promptSnippet }),
	...(tool.promptGuidelines === undefined
		? {}
		: { promptGuidelines: [...tool.promptGuidelines] }),
	...(tool.executionMode === undefined
		? {}
		: { executionMode: tool.executionMode }),
	execute: async (_toolCallId, params, signal) => {
		const context = signal === undefined ? {} : { signal };
		const normalizedParams = normalizeToolArguments(tool.parameters, params);
		const result = await tool.execute(
			normalizedParams as Record<string, unknown>,
			context,
		);
		return {
			content: [...result.content],
			details: result.details,
			...(result.terminate === undefined
				? {}
				: { terminate: result.terminate }),
		};
	},
});

const resolveToolDefinitions = async (options: {
	readonly tools: readonly PlotExtensionTool[];
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly config: unknown;
	readonly work: PlotExtensionWork;
	readonly runId?: string;
}): Promise<ToolDefinition[]> => {
	const context: PlotToolContext = {
		workflow: options.workflow,
		paths: options.paths,
		config: options.config,
		work: options.work,
		...(options.runId === undefined ? {} : { runId: options.runId }),
	};
	const resolved = await Promise.all(
		options.tools.map((tool) =>
			typeof tool === "function" ? Promise.resolve(tool(context)) : tool,
		),
	);
	const names = new Set<string>();
	for (const tool of resolved) {
		if (names.has(tool.name))
			throw new PlotExtensionSourceError({
				phase: "create",
				message: `duplicate extension tool name: ${tool.name}`,
			});
		names.add(tool.name);
	}
	return resolved.map(toPiToolDefinition);
};

const invokeOperatorActionHook = async (
	runtime: PlotExtensionRuntime,
	source: SourceId,
	work: PlotExtensionWork,
	data: Record<string, unknown>,
) => {
	try {
		const actionId = data["actionId"];
		const actionLabel = data["actionLabel"];
		const timestamp = data["timestamp"];
		if (
			typeof actionId !== "string" ||
			typeof actionLabel !== "string" ||
			typeof timestamp !== "string"
		)
			return;
		await runtime.operatorAction?.({
			work,
			actionId,
			actionLabel,
			timestamp,
			...(typeof data["comment"] === "string"
				? { comment: data["comment"] }
				: {}),
			...(typeof data["clientId"] === "string"
				? { clientId: data["clientId"] }
				: {}),
			...(data["actor"] === undefined ? {} : { actor: data["actor"] }),
		});
	} catch (error) {
		await logHookError(error, "operator_action", source);
	}
};

const invokeCompletionHook = async (
	runtime: PlotExtensionRuntime,
	source: SourceId,
	work: PlotExtensionWork,
	completion: Completion,
) => {
	const runId = String(completion.runId);
	try {
		if (completion.status === "succeeded")
			await runtime.completed?.({
				work,
				runId,
				...(completion.output === undefined
					? {}
					: { output: completion.output }),
			});
		else if (completion.status === "failed")
			await runtime.failed?.({
				work,
				runId,
				error: completion.error ?? completion.status,
			});
		else if (completion.status === "timed_out")
			await runtime.timedOut?.({ work, runId });
		else await runtime.interrupted?.({ work, runId });
	} catch (error) {
		await logHookError(error, completion.status, source);
	}
};

export const makePlotExtensionSourceBundle = (options: {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly config: unknown;
	readonly tools?: readonly PlotExtensionTool[];
	readonly maxConcurrentRuns?: number;
	readonly onWorkReleased?: (workId: string) => Promise<void> | void;
}): PlotExtensionSourceBundle => {
	const source = sourceIdForExtension(options.extension);
	const selectedWork = new Map<WorkKey, PlotExtensionWork>();
	const workSource: WorkSource = {
		id: source,
		...(options.maxConcurrentRuns === undefined
			? {}
			: { policy: { maxConcurrentRuns: options.maxConcurrentRuns } }),
		observeTick: async ({ signal }) => [
			{
				type: "plot.extension.discovered",
				subject: subjectKey(String(source)),
				data: await discover({ runtime: options.runtime, source, signal }),
			},
		],
		reconcile: async ({ snapshot, signal }) => {
			const proposals = [];
			const previousDiscoveredWorks = decodeStoredWorks(
				snapshot.facts.get(discoveredFactKey(source)),
			);
			let discoveredWorks = previousDiscoveredWorks;
			const latestDiscovery = snapshot.observations.findLast(
				(observation) =>
					observation.type === "plot.extension.discovered" &&
					observation.subject === String(source),
			);
			const shouldWriteDiscoveredFact = latestDiscovery !== undefined;
			if (latestDiscovery !== undefined)
				discoveredWorks = decodeDiscoveredWorks(
					latestDiscovery.data,
					String(source),
				);
			for (const work of discoveredWorks)
				selectedWork.set(
					workKeyForExtensionWork(options.extension, work),
					work,
				);
			const operatorActionHooks = [];
			for (const observation of snapshot.observations) {
				if (observation.type !== "operator_observation") continue;
				if (!isRecord(observation.data)) continue;
				if (observation.data["sourceId"] !== source) continue;
				const observedWorkKey = observation.data["workKey"];
				if (typeof observedWorkKey !== "string") continue;
				const work = selectedWork.get(workKey(observedWorkKey));
				if (work === undefined) continue;
				operatorActionHooks.push(
					invokeOperatorActionHook(
						options.runtime,
						source,
						work,
						observation.data,
					),
				);
			}
			await Promise.all(operatorActionHooks);
			const completedThisTickKeys = new Set<WorkKey>();
			const completionHooks = [];
			for (const completion of snapshot.completions) {
				if (completion.sourceId !== source) continue;
				completedThisTickKeys.add(completion.workKey);
				const work = selectedWork.get(completion.workKey);
				if (work === undefined) continue;
				completionHooks.push(
					invokeCompletionHook(options.runtime, source, work, completion),
				);
				if (
					!discoveredWorks.some(
						(candidate) =>
							workKeyForExtensionWork(options.extension, candidate) ===
							completion.workKey,
					)
				)
					selectedWork.delete(completion.workKey);
			}
			await Promise.all(completionHooks);
			if (completedThisTickKeys.size > 0) {
				discoveredWorks = await discover({
					runtime: options.runtime,
					source,
					signal,
				});
				discoveredWorks = discoveredWorks.filter(
					(work) =>
						!completedThisTickKeys.has(
							workKeyForExtensionWork(options.extension, work),
						),
				);
			}
			if (shouldWriteDiscoveredFact || completedThisTickKeys.size > 0)
				proposals.push(setFact(discoveredFactKey(source), discoveredWorks));
			const currentKeys = currentWorkKeys(options.extension, discoveredWorks);
			const currentIds = new Set(discoveredWorks.map((work) => work.id));
			const previousKeys = currentWorkKeys(
				options.extension,
				previousDiscoveredWorks,
			);
			const drainingIds = new Set<string>();
			const runningIds = new Set<string>();
			const drainingKeys = new Set<WorkKey>();
			for (const run of snapshot.running.values()) {
				if (run.sourceId !== source) continue;
				const known = selectedWork.get(run.workKey);
				if (currentKeys.has(run.workKey)) {
					if (known !== undefined) runningIds.add(known.id);
					continue;
				}
				if (known !== undefined && currentIds.has(known.id)) {
					drainingIds.add(known.id);
					drainingKeys.add(run.workKey);
					proposals.push(
						upsertWork(
							workRecordFor(
								options.extension,
								source,
								known,
								"draining",
								run.runId,
							),
						),
					);
					continue;
				}
				proposals.push(interruptWork(run.workKey, releasedReason(source)));
			}
			for (const work of discoveredWorks) {
				const status: WorkRecord["status"] = runningIds.has(work.id)
					? "running"
					: drainingIds.has(work.id)
						? "draining"
						: isBlocked(work)
							? "blocked"
							: "pending";
				const currentRunId = [...snapshot.running.values()].find((run) => {
					if (run.sourceId !== source) return false;
					return (
						run.workKey === workKeyForExtensionWork(options.extension, work)
					);
				})?.runId;
				proposals.push(
					upsertWork(
						workRecordFor(
							options.extension,
							source,
							work,
							status,
							currentRunId,
						),
					),
				);
			}
			const workReleasedHooks = [];
			for (const key of previousKeys) {
				if (currentKeys.has(key) || drainingKeys.has(key)) continue;
				proposals.push(removeWork(key));
				const previous = previousDiscoveredWorks.find(
					(work) => workKeyForExtensionWork(options.extension, work) === key,
				);
				if (!snapshot.running.has(key) && previous !== undefined)
					selectedWork.delete(key);
				if (previous !== undefined && options.onWorkReleased !== undefined)
					workReleasedHooks.push(
						Promise.resolve(options.onWorkReleased(previous.id)).catch(
							(error: unknown) => logHookError(error, "work_released", source),
						),
					);
			}
			await Promise.all(workReleasedHooks);
			return proposals;
		},
		continueWork: async ({ work, signal }) => {
			const active = selectedWork.get(work.workKey);
			if (active === undefined) return false;
			const discovered = await discover({
				runtime: options.runtime,
				source,
				signal,
			});
			return discovered.some(
				(candidate) =>
					!isBlocked(candidate) &&
					workKeyForExtensionWork(options.extension, candidate) ===
						work.workKey,
			);
		},
		selectWork: ({ snapshot }) => {
			const claimedIds = new Set<string>();
			for (const run of snapshot.running.values()) {
				if (run.sourceId !== source) continue;
				const known = selectedWork.get(run.workKey);
				if (known !== undefined) claimedIds.add(known.id);
			}
			return decodeStoredWorks(
				snapshot.facts.get(discoveredFactKey(source)),
			).flatMap((extensionWork) => {
				const key = workKeyForExtensionWork(options.extension, extensionWork);
				if (
					snapshot.running.has(key) ||
					claimedIds.has(extensionWork.id) ||
					isBlocked(extensionWork)
				)
					return [];
				selectedWork.set(key, extensionWork);
				return [
					{
						workKey: key,
						subject: toSubject(extensionWork),
						templateContext: templateContextForWork(
							options.workflow,
							extensionWork,
						),
						...(extensionWork.display === undefined
							? {}
							: { display: extensionWork.display }),
						...(extensionWork.operatorActions === undefined
							? {}
							: { operatorActions: extensionWork.operatorActions }),
					},
				];
			});
		},
	};
	return {
		source: workSource,
		workFor: (context) => selectedWork.get(context.work.workKey),
		createOptions: async (context) => {
			const work = selectedWork.get(context.work.workKey);
			if (work === undefined || !options.tools?.length)
				return { customTools: [] };
			return {
				customTools: await resolveToolDefinitions({
					tools: options.tools,
					workflow: options.workflow,
					paths: options.paths,
					config: options.config,
					work,
					runId: String(context.run.runId),
				}),
			};
		},
		wrapRunner: (runner) => ({
			run: async (context: WorkRunnerContext) => {
				const work = selectedWork.get(context.work.workKey);
				if (work !== undefined) {
					try {
						await options.runtime.started?.({
							work,
							runId: String(context.run.runId),
						});
					} catch (error) {
						await logHookError(error, "started", source);
					}
				}
				return runner.run(context);
			},
		}),
		shutdown: async () => {
			const controller = new AbortController();
			try {
				await options.runtime.shutdown?.({ signal: controller.signal });
			} catch (error) {
				await logHookError(error, "shutdown", source);
			}
		},
	};
};

const extensionVirtualModules: Record<string, unknown> = {
	"plot-ai/sdk": plotSdk,
};

const importExtensionModule = async (source: string): Promise<unknown> => {
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		tryNative: false,
		virtualModules: extensionVirtualModules,
	});
	return jiti.import(source);
};

const getModuleExtension = (module: unknown): PlotExtension | undefined => {
	if (!isRecord(module)) return undefined;
	const candidate = module["default"] ?? module["extension"];
	if (!isRecord(candidate)) return undefined;
	if (typeof candidate["id"] !== "string" || candidate["id"].length === 0)
		return undefined;
	if (typeof candidate["create"] !== "function") return undefined;
	return candidate as unknown as PlotExtension;
};

const resolveExtensionSourcePath = (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly source: string;
}) => {
	if (isAbsolute(options.source)) return options.source;
	const base =
		options.workflow.path === undefined
			? options.paths.cwd
			: dirname(options.workflow.path);
	return resolve(base, options.source);
};

export const loadPlotExtensionRuntimeFromWorkflow = async (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
}): Promise<LoadedPlotExtensionRuntime> => {
	const extensionConfig = options.workflow.runtime.extension;
	if (extensionConfig === undefined)
		throw new PlotExtensionSourceError({
			phase: "load",
			message: "workflow does not configure an extension source",
		});
	const source = resolveExtensionSourcePath({
		workflow: options.workflow,
		paths: options.paths,
		source: extensionConfig.source,
	});
	let module: unknown;
	try {
		module = await importExtensionModule(source);
	} catch (error) {
		throw new PlotExtensionSourceError({
			phase: "load",
			source,
			message: errorMessage(error),
		});
	}
	const extension = getModuleExtension(module);
	if (extension === undefined)
		throw new PlotExtensionSourceError({
			phase: "load",
			source,
			message:
				"extension module must export a PlotExtension as default or extension",
		});
	const config = extension.parseConfig
		? await runMaybePromise("config", source, () =>
				extension.parseConfig?.(extensionConfig.config),
			)
		: extensionConfig.config;
	const tools: PlotExtensionTool[] = [];
	const runtime = await runMaybePromise("create", source, () =>
		extension.create({
			config,
			workflow: options.workflow,
			paths: options.paths,
			work: (input) => cleanWork(extensionWorkSchema.parse(input)),
			registerTool: (tool) => {
				tools.push(tool as PlotExtensionTool);
			},
		}),
	);
	return { extension, runtime, tools, config };
};

export const makePlotExtensionSourceBundleFromWorkflow = async (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly onWorkReleased?: (workId: string) => Promise<void> | void;
}): Promise<PlotExtensionSourceBundle> => {
	const { extension, runtime, tools, config } =
		await loadPlotExtensionRuntimeFromWorkflow(options);
	return makePlotExtensionSourceBundle({
		extension,
		runtime,
		workflow: options.workflow,
		paths: options.paths,
		config,
		tools,
		...(options.onWorkReleased === undefined
			? {}
			: { onWorkReleased: options.onWorkReleased }),
		...(options.workflow.runtime.extension?.maxConcurrentRuns === undefined
			? {}
			: {
					maxConcurrentRuns:
						options.workflow.runtime.extension.maxConcurrentRuns,
				}),
	});
};
