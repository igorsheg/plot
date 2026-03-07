export interface ServerConfig {
	workflowPath: string;
	port: number;
	issuesDir: string;
	webDistDir: string;
	webEnabled: boolean;
	logFormat: "pretty" | "json";
	logLevel: "debug" | "info" | "warning" | "error" | "none";
	trackerKind: "local-fs" | "github";
	githubRepo: string;
}

const LOG_FORMATS = ["pretty", "json"] as const;
const LOG_LEVELS = ["debug", "info", "warning", "error", "none"] as const;
const TRACKER_KINDS = ["local-fs", "github"] as const;

function isEnumValue<T extends string>(
	valid: ReadonlyArray<T>,
	value: string,
): value is T {
	return valid.some((entry) => entry === value);
}

function parseEnum<T extends string>(
	value: string | undefined,
	valid: ReadonlyArray<T>,
	fallback: T,
): T {
	if (value !== undefined && isEnumValue(valid, value)) return value;
	return fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	return value === "1" || value.toLowerCase() === "true";
}

export function readConfigFromEnv(
	env: Record<string, string | undefined>,
): ServerConfig {
	const port = parseInt(env["PLOT_PORT"] ?? "3000", 10);
	if (Number.isNaN(port) || port < 0 || port > 65535) {
		throw new Error(`invalid PLOT_PORT: ${env["PLOT_PORT"]}`);
	}

	return {
		workflowPath: env["PLOT_WORKFLOW"] ?? "./WORKFLOW.md",
		port,
		issuesDir: env["PLOT_ISSUES_DIR"] ?? "./issues",
		webDistDir: env["PLOT_WEB_DIST_DIR"] ?? "",
		webEnabled: parseBoolean(env["PLOT_WEB_ENABLED"], false),
		logFormat: parseEnum(env["PLOT_LOG_FORMAT"], LOG_FORMATS, "pretty"),
		logLevel: parseEnum(env["PLOT_LOG_LEVEL"], LOG_LEVELS, "info"),
		trackerKind: parseEnum(env["PLOT_TRACKER_KIND"], TRACKER_KINDS, "local-fs"),
		githubRepo: env["PLOT_GITHUB_REPO"] ?? "",
	};
}
