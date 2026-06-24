import { Eta } from "eta";
import type { WorkRunnerContext } from "@plot/agent/work-runner";
import { errorMessage } from "./util.js";

export class PlotPromptTemplateError extends Error {
	override readonly name = "PlotPromptTemplateError";
	readonly phase?: "render" | undefined;
	constructor(input: { readonly phase?: "render"; readonly message: string }) {
		super(input.message);
		this.phase = input.phase;
	}
}
const eta = new Eta({
	tags: ["{{", "}}"],
	parse: { exec: "#", interpolate: "", raw: "~" },
	useWith: true,
	autoEscape: false,
	debug: true,
});
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
export const renderPromptTemplate = async (
	template: string,
	data: Record<string, unknown>,
): Promise<string> => {
	try {
		return eta.renderString(template, data);
	} catch (error) {
		throw new PlotPromptTemplateError({
			phase: "render",
			message: errorMessage(error),
		});
	}
};
export const renderPromptTemplateForRunnerContext = (
	template: string,
	context: WorkRunnerContext,
): Promise<string> =>
	renderPromptTemplate(template, makePromptTemplateData(context));
