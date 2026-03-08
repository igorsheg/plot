import { Config, ConfigError, Either, Option, Schema } from "effect";
import { WorkflowConfig } from "./schemas/workflow.js";
import { parse as parseYaml } from "yaml";

const LogFormat = Schema.Literal("pretty", "json");
const LogLevel = Schema.Literal("debug", "info", "warning", "error", "none");
const TrackerKind = Schema.Literal("local-fs", "github");

export interface WorkflowOverrides {
  readonly trackerKind?: "local-fs" | "github";
  readonly githubRepo?: string;
  readonly issuesDir?: string;
}

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
  trackerKind: Schema.Config("TRACKER_KIND", TrackerKind).pipe(Config.option),
  githubRepo: Config.string("GITHUB_REPO").pipe(Config.option),
  issuesDir: Config.string("ISSUES_DIR").pipe(Config.option),
}).pipe(
  Config.nested("PLOT"),
  Config.map((raw) => ({
    workflowPath: raw.workflowPath,
    port: raw.port,
    webDistDir: raw.webDistDir,
    webEnabled: raw.webEnabled,
    logFormat: raw.logFormat,
    logLevel: raw.logLevel,
    overrides: {
      trackerKind: Option.getOrUndefined(raw.trackerKind),
      githubRepo: Option.getOrUndefined(raw.githubRepo),
      issuesDir: Option.getOrUndefined(raw.issuesDir),
    },
  })),
);

const snakeToCamel = (s: string): string =>
  s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

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

export function parseWorkflowFrontmatter(content: string): WorkflowConfig {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return new WorkflowConfig({});
  }

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    return new WorkflowConfig({});
  }

  const yamlBlock = trimmed.slice(3, endIdx);
  try {
    const parsed = parseYaml(yamlBlock);
    if (
      parsed === null ||
      parsed === undefined ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return new WorkflowConfig({});
    }
    return Schema.decodeUnknownSync(WorkflowConfig)(transformKeys(parsed));
  } catch {
    return new WorkflowConfig({});
  }
}
