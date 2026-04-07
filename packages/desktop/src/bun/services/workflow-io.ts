import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import matter from "gray-matter";
import { stringify as yamlStringify } from "yaml";
import { Effect, Layer, ServiceMap } from "effect";
import type { WorkflowDocument, WorkflowConfig } from "../../shared/rpc";
import { GITHUB_WORKFLOW_BODY } from "./templates/github-workflow-body";

const MINIMAL_DEFAULT_BODY = "## Instructions\n\nWork on the assigned issue.\nKeep diffs minimal.\nProve changes with checks before claiming success.";

/**
 * Default prompt body for new projects, selected by tracker kind.
 * github → full plot workflow protocol (state machine, workpad contract, flows)
 * other  → minimal placeholder
 */
function defaultPromptBody(config: WorkflowConfig): string {
	if (config.tracker?.kind === "github") return GITHUB_WORKFLOW_BODY;
	return MINIMAL_DEFAULT_BODY;
}

const snakeToCamel = (s: string): string =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const camelToSnake = (s: string): string =>
	s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const transformKeys = (obj: unknown): unknown => {
	if (Array.isArray(obj)) return obj.map(transformKeys);
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			result[snakeToCamel(k)] = transformKeys(v);
		}
		return result;
	}
	return obj;
};

const transformKeysToSnake = (obj: unknown): unknown => {
	if (Array.isArray(obj)) return obj.map(transformKeysToSnake);
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			result[camelToSnake(k)] = transformKeysToSnake(v);
		}
		return result;
	}
	return obj;
};

export class WorkflowIO extends ServiceMap.Service<WorkflowIO>()("WorkflowIO", {
	make: Effect.succeed({
		read: (projectPath: string) =>
			Effect.sync((): WorkflowDocument | null => {
				const filePath = path.join(projectPath, "WORKFLOW.md");
				if (!existsSync(filePath)) return null;

				const content = readFileSync(filePath, "utf-8");
				const { data, content: body } = matter(content);
				const config =
					data && typeof data === "object" && !Array.isArray(data)
						? (transformKeys(data) as WorkflowConfig)
						: {};

				return { config, promptBody: body.trim() };
			}),

		write: (projectPath: string, doc: WorkflowDocument) =>
			Effect.sync(() => {
				const filePath = path.join(projectPath, "WORKFLOW.md");
				const snaked = transformKeysToSnake(doc.config) as Record<string, unknown>;
				const yaml = yamlStringify(snaked, { lineWidth: 0 });
				const content = `---\n${yaml}---\n\n${doc.promptBody}\n`;
				writeFileSync(filePath, content);
			}),

		createFromConfig: (projectPath: string, config: WorkflowConfig) =>
			Effect.sync(() => {
				const promptBody = defaultPromptBody(config);
				const doc: WorkflowDocument = { config, promptBody };
				const filePath = path.join(projectPath, "WORKFLOW.md");
				const snaked = transformKeysToSnake(doc.config) as Record<string, unknown>;
				const yaml = yamlStringify(snaked, { lineWidth: 0 });
				const content = `---\n${yaml}---\n\n${doc.promptBody}\n`;
				writeFileSync(filePath, content);
				return doc;
			}),
	}),
}) {
	static layer = Layer.effect(this, this.make);
}
