import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerOptions } from "./options.js";

const cliDir = dirname(fileURLToPath(import.meta.url));

export function resolveBundledWebDistDir() {
	return process.env["PLOT_WEB_DIST_DIR"] ?? join(cliDir, "../../../web/dist");
}

export function resolveBundledPiSkillsDir() {
	return (
		process.env["PLOT_PI_SKILLS_DIR"] ??
		join(cliDir, "../../../pi-package/skills")
	);
}

export function stripBundledEntryArg(argv: string[]) {
	return argv[0]?.startsWith("/$bunfs/") ? argv.slice(1) : argv;
}

export function buildSelfCommandArgs(
	execPath: string,
	entry: string | undefined,
	command: string,
) {
	if (
		entry &&
		/\.(?:[cm]?js|ts|mts|cts)$/.test(entry) &&
		!entry.startsWith("/$bunfs/")
	) {
		return [execPath, entry, command];
	}
	return [execPath, command];
}

export function resolveSelfCommandArgs(command: string) {
	return buildSelfCommandArgs(process.execPath, process.argv[1], command);
}

export function toServerEnv(opts: ServerOptions): Record<string, string> {
	return {
		...process.env,
		PLOT_WORKFLOW: opts.workflow,
		PLOT_PORT: String(opts.port),
		PLOT_TRACKER_KIND: opts.tracker,
		PLOT_GITHUB_REPO: opts["github-repo"] ?? "",
		PLOT_ISSUES_DIR: opts["issues-dir"],
		PLOT_LOG_FORMAT: opts.json ? "json" : opts["log-format"],
		PLOT_LOG_LEVEL: opts["log-level"],
		PLOT_WEB_ENABLED: opts.web ? "1" : "0",
		PLOT_WEB_DIST_DIR: resolveBundledWebDistDir(),
		PLOT_PI_SKILLS_DIR: resolveBundledPiSkillsDir(),
	};
}
