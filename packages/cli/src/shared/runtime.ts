import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerOptions } from "./options.js";

const cliDir = dirname(fileURLToPath(import.meta.url));

export function resolveBundledWebDistDir() {
	return process.env["PLOT_WEB_DIST_DIR"] ?? join(cliDir, "../../../web/dist");
}

export function resolveSelfCommandArgs(command: string) {
	const entry = process.argv[1];
	if (entry && /\.(?:[cm]?js|ts|mts|cts)$/.test(entry)) {
		return [process.execPath, entry, command];
	}
	return [process.execPath, command];
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
		PLOT_WEB_DIST_DIR: resolveBundledWebDistDir(),
	};
}
