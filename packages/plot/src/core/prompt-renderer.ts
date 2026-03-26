import { Effect, Schema } from "effect";
import { Eta } from "eta";
export class TemplateRenderError extends Schema.TaggedErrorClass<TemplateRenderError>()(
	"TemplateRenderError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect),
	},
) {
	override get message(): string {
		return `Template render error: ${this.message}`;
	}
}
import type { Issue } from "@plot/sdk";

const eta = new Eta({ useWith: true });

export const renderPrompt = (
	template: string,
	issue: Issue,
	attempt: number | null,
	context: string | null,
): Effect.Effect<string, TemplateRenderError> =>
	Effect.try({
		try: () =>
			eta.renderString(template, {
				issue: {
					id: issue.id,
					identifier: issue.identifier,
					title: issue.title,
					description: issue.description,
					priority: issue.priority,
					state: issue.state,
					branch_name: issue.branchName,
					url: issue.url,
					labels: issue.labels,
					blocked_by: issue.blockedBy,
					created_at: issue.createdAt ?? null,
					updated_at: issue.updatedAt ?? null,
				},
				attempt,
				context,
			}),
		catch: (e) => new TemplateRenderError({ message: `Template render failed: ${e}` }),
	});
