import { Config, Effect, Option } from "effect";
import type { WorkflowConfig } from "@plot/sdk";
import { WorkflowParseError } from "./core/errors.js";
import { extractFrontmatter } from "./core/workflow-loader.js";

export interface WorkflowOverrides {
	readonly trackerKind?: string;
	readonly githubRepo?: string;
}

export const WorkflowOverridesConfig: Config.Config<WorkflowOverrides> = Config.all({
	trackerKind: Config.string("TRACKER_KIND").pipe(Config.option),
	githubRepo: Config.string("GITHUB_REPO").pipe(Config.option),
}).pipe(
	Config.map((raw) => ({
		trackerKind: Option.getOrUndefined(raw.trackerKind),
		githubRepo: Option.getOrUndefined(raw.githubRepo),
	})),
);

export interface ServerConfig {
	readonly workflowPath: string;
	readonly port: number;
	readonly webDistDir: string;
	readonly webEnabled: boolean;
	readonly logFormat: "pretty" | "json";
	readonly logLevel: "debug" | "info" | "warning" | "error" | "none";
	readonly refreshPlugins: boolean;
	readonly overrides: WorkflowOverrides;
}

export const ServerConfig: Config.Config<ServerConfig> = Config.all({
	workflowPath: Config.string("WORKFLOW").pipe(Config.withDefault("./WORKFLOW.md")),
	port: Config.int("PORT").pipe(
		Config.withDefault(3000),
		Config.mapOrFail((port) =>
			port >= 0 && port <= 65535
				? Effect.succeed(port)
				: Effect.die(`port must be 0-65535, got ${port}`),
		),
	),
	webDistDir: Config.string("WEB_DIST_DIR").pipe(Config.withDefault("")),
	webEnabled: Config.boolean("WEB_ENABLED").pipe(Config.withDefault(false)),
	logFormat: Config.string("LOG_FORMAT").pipe(
		Config.withDefault("pretty"),
		Config.mapOrFail((s) => {
			const valid = ["pretty", "json"] as const;
			type T = (typeof valid)[number];
			if ((valid as readonly string[]).includes(s)) return Effect.succeed(s as T);
			return Effect.die(`invalid LOG_FORMAT: ${s}`);
		}),
	),
	logLevel: Config.string("LOG_LEVEL").pipe(
		Config.withDefault("info"),
		Config.mapOrFail((s) => {
			const valid = ["debug", "info", "warning", "error", "none"] as const;
			type T = (typeof valid)[number];
			if ((valid as readonly string[]).includes(s)) return Effect.succeed(s as T);
			return Effect.die(`invalid LOG_LEVEL: ${s}`);
		}),
	),
	refreshPlugins: Config.boolean("REFRESH_PLUGINS").pipe(Config.withDefault(false)),
	overrides: WorkflowOverridesConfig,
}).pipe(Config.nested("PLOT"));

export function parseWorkflowFrontmatter(content: string): WorkflowConfig {
	try {
		const { configRaw } = extractFrontmatter(content);
		return configRaw as WorkflowConfig;
	} catch (error) {
		throw new WorkflowParseError({
			message: error instanceof Error ? error.message : `workflow parse failed: ${String(error)}`,
		});
	}
}
