import { Eta } from "eta";
import { Effect, Schema } from "effect";
import type { WorkRunnerContext } from "@plot/agent/work-runner";

export class PlotPromptTemplateError extends Schema.TaggedErrorClass<PlotPromptTemplateError>()(
	"PlotPromptTemplateError",
	{
		phase: Schema.Literals(["render"]),
		message: Schema.String,
	},
) {}

const eta = new Eta({
	tags: ["{{", "}}"],
	parse: {
		exec: "#",
		interpolate: "",
		raw: "~",
	},
	useWith: true,
	autoEscape: false,
	debug: true,
});

const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

const isTemplateData = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const makePromptTemplateData = (
	context: WorkRunnerContext,
): Record<string, unknown> => {
	const templateContext = context.work.templateContext;
	if (templateContext === undefined) return {};
	if (isTemplateData(templateContext)) return templateContext;
	return { value: templateContext };
};

export const renderPromptTemplate = (
	template: string,
	data: Record<string, unknown>,
): Effect.Effect<string, PlotPromptTemplateError> =>
	Effect.try({
		try: () => eta.renderString(template, data),
		catch: (error) =>
			new PlotPromptTemplateError({
				phase: "render",
				message: errorMessage(error),
			}),
	});

export const renderPromptTemplateForRunnerContext = (
	template: string,
	context: WorkRunnerContext,
): Effect.Effect<string, PlotPromptTemplateError> =>
	renderPromptTemplate(template, makePromptTemplateData(context));
