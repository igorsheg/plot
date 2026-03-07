import { DateTime, Effect } from "effect";
import { TemplateRenderError } from "@plot/sdk";
import type { Issue } from "@plot/sdk";
import { Liquid } from "liquidjs";

const engine = new Liquid({ strictVariables: true, strictFilters: true });

export const renderPrompt = (
  template: string,
  issue: Issue,
  attempt: number | null,
): Effect.Effect<string, TemplateRenderError> =>
  Effect.tryPromise({
    try: () =>
      engine.parseAndRender(template, {
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
