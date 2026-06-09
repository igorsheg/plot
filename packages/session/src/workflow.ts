import { Context, Effect, Layer, Schema } from "effect";
import { readFile } from "node:fs/promises";
import { withWideEvent } from "@plot/common/observability";
import { parse as parseYaml } from "yaml";

export class PlotWorkflowError extends Schema.TaggedErrorClass<PlotWorkflowError>()(
	"PlotWorkflowError",
	{
		phase: Schema.Literals(["read", "parse"]),
		message: Schema.String,
		path: Schema.optionalKey(Schema.String),
	},
) {}

export const AgentToolMode = Schema.Union([
	Schema.Boolean,
	Schema.Literals(["all", "builtin"]),
]);
export type AgentToolMode = typeof AgentToolMode.Type;

export const WorkflowAgentConfig = Schema.Struct({
	provider: Schema.optionalKey(Schema.String),
	model: Schema.optionalKey(Schema.String),
	thinking: Schema.optionalKey(
		Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh"]),
	),
	tools: Schema.optionalKey(Schema.Array(Schema.String)),
	excludeTools: Schema.optionalKey(Schema.Array(Schema.String)),
	noTools: Schema.optionalKey(AgentToolMode),
	allowProjectConfig: Schema.optionalKey(Schema.Boolean),
});
export type WorkflowAgentConfig = typeof WorkflowAgentConfig.Type;

export const WorkflowPlotConfig = Schema.Struct({
	tickIntervalMs: Schema.optionalKey(Schema.Number),
	maxRunDurationMs: Schema.optionalKey(Schema.Number),
	queueCapacity: Schema.optionalKey(Schema.Number),
	eventCapacity: Schema.optionalKey(Schema.Number),
	replayCapacity: Schema.optionalKey(Schema.Number),
});
export type WorkflowPlotConfig = typeof WorkflowPlotConfig.Type;

export const WorkflowResourcesConfig = Schema.Struct({
	skills: Schema.optionalKey(Schema.Array(Schema.String)),
	extensions: Schema.optionalKey(Schema.Array(Schema.String)),
	prompts: Schema.optionalKey(Schema.Array(Schema.String)),
	themes: Schema.optionalKey(Schema.Array(Schema.String)),
	contextFiles: Schema.optionalKey(Schema.Boolean),
});
export type WorkflowResourcesConfig = typeof WorkflowResourcesConfig.Type;

export const WorkflowRuntimeConfig = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	plot: Schema.optionalKey(WorkflowPlotConfig),
	agent: Schema.optionalKey(WorkflowAgentConfig),
	resources: Schema.optionalKey(WorkflowResourcesConfig),
});
export type WorkflowRuntimeConfig = typeof WorkflowRuntimeConfig.Type;

export const WorkflowDefinition = Schema.Struct({
	config: Schema.Record(Schema.String, Schema.Unknown),
	runtime: WorkflowRuntimeConfig,
	prompt: Schema.String,
	path: Schema.optionalKey(Schema.String),
});
export type WorkflowDefinition = typeof WorkflowDefinition.Type;

const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

export interface WorkflowFileSystemShape {
	readonly readFileString: (
		path: string,
	) => Effect.Effect<string, PlotWorkflowError>;
}

export class WorkflowFileSystem extends Context.Service<
	WorkflowFileSystem,
	WorkflowFileSystemShape
>()("@plot/session/WorkflowFileSystem") {}

export const nodeWorkflowFileSystemLayer = Layer.succeed(WorkflowFileSystem, {
	readFileString: (path) =>
		withWideEvent(
			"workflow.read",
			{ path },
			Effect.tryPromise({
				try: () => readFile(path, "utf8"),
				catch: (error) =>
					new PlotWorkflowError({
						phase: "read",
						path,
						message: errorMessage(error),
					}),
			}),
		),
});

const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const parseConfig = (frontMatter: string, path: string | undefined) =>
	Effect.try({
		try: () => {
			const parsed = frontMatter.trim() === "" ? {} : parseYaml(frontMatter);
			if (parsed === null) return {};
			if (typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("workflow front matter must be an object");
			}
			return parsed as Record<string, unknown>;
		},
		catch: (error) =>
			new PlotWorkflowError({
				phase: "parse",
				message: errorMessage(error),
				...(path === undefined ? {} : { path }),
			}),
	});

const decodeRuntimeConfig = (
	config: Record<string, unknown>,
	path: string | undefined,
) =>
	Schema.decodeUnknownEffect(WorkflowRuntimeConfig)(config).pipe(
		Effect.mapError(
			(error) =>
				new PlotWorkflowError({
					phase: "parse",
					message: error.message,
					...(path === undefined ? {} : { path }),
				}),
		),
	);

export const parseWorkflowText = (
	text: string,
	path?: string,
): Effect.Effect<WorkflowDefinition, PlotWorkflowError> =>
	withWideEvent(
		"workflow.parse",
		{ ...(path === undefined ? {} : { path }), bytes: text.length },
		Effect.gen(function* () {
			const match = frontMatterPattern.exec(text);
			const frontMatter = match?.[1] ?? "";
			const prompt = match ? text.slice(match[0].length).trim() : text.trim();
			const config = yield* parseConfig(frontMatter, path);
			const runtime = yield* decodeRuntimeConfig(config, path);
			return yield* Schema.decodeUnknownEffect(WorkflowDefinition)({
				config,
				runtime,
				prompt,
				...(path === undefined ? {} : { path }),
			}).pipe(
				Effect.mapError(
					(error) =>
						new PlotWorkflowError({
							phase: "parse",
							message: errorMessage(error),
							...(path === undefined ? {} : { path }),
						}),
				),
			);
		}),
	);

export const loadWorkflow = (
	path = "WORKFLOW.md",
): Effect.Effect<WorkflowDefinition, PlotWorkflowError, WorkflowFileSystem> =>
	withWideEvent(
		"workflow.load",
		{ path },
		Effect.gen(function* () {
			const fileSystem = yield* WorkflowFileSystem;
			const text = yield* fileSystem.readFileString(path);
			return yield* parseWorkflowText(text, path);
		}),
	);

export const loadWorkflowFromNode = (
	path = "WORKFLOW.md",
): Effect.Effect<WorkflowDefinition, PlotWorkflowError> =>
	loadWorkflow(path).pipe(Effect.provide(nodeWorkflowFileSystemLayer));
