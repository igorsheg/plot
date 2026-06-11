import { Result, TaggedError } from "better-result";
import { Eta } from "eta";
import type { WorkRunnerContext } from "@plot/agent/work-runner";

export class PlotPromptTemplateError extends TaggedError(
	"PlotPromptTemplateError",
)<{
	readonly phase?: "render";
	readonly message: string;
}>() {}
const eta = new Eta({
	tags: ["{{", "}}"],
	parse: { exec: "#", interpolate: "", raw: "~" },
	useWith: true,
	autoEscape: false,
	debug: true,
});
const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
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
export const renderPromptTemplateResult = (
	template: string,
	data: Record<string, unknown>,
): Result<string, PlotPromptTemplateError> =>
	Result.try({
		try: () => eta.renderString(template, data),
		catch: (error) =>
			new PlotPromptTemplateError({
				phase: "render",
				message: errorMessage(error),
			}),
	});
export const renderPromptTemplate = async (
	template: string,
	data: Record<string, unknown>,
): Promise<string> => {
	const result = renderPromptTemplateResult(template, data);
	if (Result.isError(result)) throw result.error;
	return result.value;
};
export const renderPromptTemplateForRunnerContext = (
	template: string,
	context: WorkRunnerContext,
): Promise<string> =>
	renderPromptTemplate(template, makePromptTemplateData(context));
