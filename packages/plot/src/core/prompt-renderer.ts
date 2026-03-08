import { DateTime, Effect } from "effect";
import { Eta } from "eta";
import { TemplateRenderError } from "../schemas/errors.js";
import type { Issue } from "../schemas/issue.js";

const eta = new Eta({ useWith: true });

export const renderPrompt = (
  template: string,
  issue: Issue,
  attempt: number | null,
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
          created_at: issue.createdAt ? DateTime.toEpochMillis(issue.createdAt) : null,
          updated_at: issue.updatedAt ? DateTime.toEpochMillis(issue.updatedAt) : null,
        },
        attempt,
      }),
    catch: (e) => new TemplateRenderError({ message: `Template render failed: ${e}` }),
  });
