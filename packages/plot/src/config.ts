import { Config, ConfigError, Either, Option, Schema } from "effect";
import { WorkflowConfig } from "@plot/sdk";
import { extractFrontmatter } from "./core/workflow-parse.js";

const LogFormat = Schema.Literal("pretty", "json");
const LogLevel = Schema.Literal("debug", "info", "warning", "error", "none");

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
  readonly overrides: WorkflowOverrides;
}

export const ServerConfig: Config.Config<ServerConfig> = Config.all({
  workflowPath: Config.string("WORKFLOW").pipe(Config.withDefault("./WORKFLOW.md")),
  port: Config.integer("PORT").pipe(
    Config.withDefault(3000),
    Config.mapOrFail((port) =>
      port >= 0 && port <= 65535
        ? Either.right(port)
        : Either.left(ConfigError.InvalidData(["PORT"], `port must be 0-65535, got ${port}`)),
    ),
  ),
  webDistDir: Config.string("WEB_DIST_DIR").pipe(Config.withDefault("")),
  webEnabled: Config.boolean("WEB_ENABLED").pipe(Config.withDefault(false)),
  logFormat: Schema.Config("LOG_FORMAT", LogFormat).pipe(Config.withDefault("pretty" as const)),
  logLevel: Schema.Config("LOG_LEVEL", LogLevel).pipe(Config.withDefault("info" as const)),
  overrides: WorkflowOverridesConfig,
}).pipe(Config.nested("PLOT"));

export function parseWorkflowFrontmatter(content: string): WorkflowConfig {
  try {
    const { configRaw } = extractFrontmatter(content);
    return Schema.decodeUnknownSync(WorkflowConfig)(configRaw);
  } catch {
    return new WorkflowConfig({});
  }
}
