import { Context, Effect, Layer, Schema } from "effect";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export class PlotWorkflowError extends Schema.TaggedErrorClass<PlotWorkflowError>()(
	"PlotWorkflowError",
	{
		phase: Schema.Literals(["read", "parse"]),
		message: Schema.String,
		path: Schema.optionalKey(Schema.String),
	},
) {}

export const WorkflowDefinition = Schema.Struct({
	config: Schema.Record(Schema.String, Schema.Unknown),
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
		Effect.tryPromise({
			try: () => readFile(path, "utf8"),
			catch: (error) =>
				new PlotWorkflowError({
					phase: "read",
					path,
					message: errorMessage(error),
				}),
		}),
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

export const parseWorkflowText = (
	text: string,
	path?: string,
): Effect.Effect<WorkflowDefinition, PlotWorkflowError> =>
	Effect.gen(function* () {
		const match = frontMatterPattern.exec(text);
		const frontMatter = match?.[1] ?? "";
		const prompt = match ? text.slice(match[0].length).trim() : text.trim();
		const config = yield* parseConfig(frontMatter, path);
		return yield* Schema.decodeUnknownEffect(WorkflowDefinition)({
			config,
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
	});

export const loadWorkflow = (
	path = "WORKFLOW.md",
): Effect.Effect<WorkflowDefinition, PlotWorkflowError, WorkflowFileSystem> =>
	Effect.gen(function* () {
		const fileSystem = yield* WorkflowFileSystem;
		const text = yield* fileSystem.readFileString(path);
		return yield* parseWorkflowText(text, path);
	});

export const loadWorkflowFromNode = (
	path = "WORKFLOW.md",
): Effect.Effect<WorkflowDefinition, PlotWorkflowError> =>
	loadWorkflow(path).pipe(Effect.provide(nodeWorkflowFileSystemLayer));
