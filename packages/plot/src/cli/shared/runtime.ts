import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ServerOptions } from "./options.js";

const compiled = import.meta.url.includes("/$bunfs/");
const cliDir = dirname(fileURLToPath(import.meta.url));
const binDir = compiled ? dirname(process.execPath) : null;
const packageDir = binDir ? dirname(binDir) : null;

export function resolveBundledWebDistDir() {
	return (
		process.env["PLOT_WEB_DIST_DIR"] ??
		(packageDir ? join(packageDir, "web-dist") : join(cliDir, "../../../../web/dist"))
	);
}

export function resolveBundledPiSkillsDir() {
	return (
		process.env["PLOT_PI_SKILLS_DIR"] ??
		(packageDir
			? join(packageDir, "pi-resources", "skills")
			: join(cliDir, "../../../resources/skills"))
	);
}
export function resolveCliArgs(argv: string[]) {
	const [, entry, ...rest] = argv;
	if (entry && isScriptEntry(entry)) {
		return rest;
	}
	return argv.slice(1);
}
function isScriptEntry(entry: string) {
	return /\.(?:[cm]?js|ts|mts|cts)$/.test(entry) || entry.startsWith("/$bunfs/");
}

function buildSelfCommandArgs(execPath: string, entry: string | undefined, command: string) {
	if (entry && /\.(?:[cm]?js|ts|mts|cts)$/.test(entry) && !entry.startsWith("/$bunfs/")) {
		return [execPath, entry, command];
	}
	return [execPath, command];
}

export function resolveSelfCommandArgs(command: string) {
	return buildSelfCommandArgs(process.execPath, process.argv[1], command);
}

export function resolveTuiServerLogPath() {
	return join(homedir(), ".plot", "logs", "tui-server.log");
}

export function toServerEnv(opts: ServerOptions): Record<string, string> {
	const env: Record<string, string> = {
		...(process.env as Record<string, string>),
		PLOT_WORKFLOW: opts.workflow,
		PLOT_PORT: String(opts.port),
		PLOT_LOG_FORMAT: opts["log-format"],
		PLOT_LOG_LEVEL: opts["log-level"],
		PLOT_WEB_ENABLED: opts.web ? "1" : "0",
		PLOT_WEB_DIST_DIR: resolveBundledWebDistDir(),
		PLOT_PI_SKILLS_DIR: resolveBundledPiSkillsDir(),
	};

	if (opts["refresh-plugins"]) {
		env["PLOT_REFRESH_PLUGINS"] = "true";
	}
	if (opts.tracker) {
		env["PLOT_TRACKER_KIND"] = opts.tracker;
	}
	if (opts["github-repo"]) {
		env["PLOT_GITHUB_REPO"] = opts["github-repo"];
	}

	return env;
}

export function toTuiServerEnv(opts: ServerOptions): Record<string, string> {
	return {
		...toServerEnv(opts),
		PLOT_LOG_FORMAT: "json",
		PLOT_LOG_LEVEL: "none",
		PLOT_TUI_SERVER_LOG_PATH: resolveTuiServerLogPath(),
	};
}
