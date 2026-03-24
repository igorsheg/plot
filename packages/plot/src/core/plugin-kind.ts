/**
 * Plugin kind classification.
 *
 * Determines how a tracker plugin `kind` string from WORKFLOW.md should be resolved:
 *
 * - **builtin**: a well-known name like "github" or "beads", resolved from the built-in registry.
 * - **local**: a filesystem path (relative, absolute, or tilde-prefixed), loaded via import().
 * - **npm**: an npm package specifier, installed to ~/.plot/plugins/ and imported from there.
 *
 * Explicit prefixes are supported for clarity:
 *   kind: 'npm:@wix/plot-jira-tracker'
 *   kind: 'file:./trackers/custom.ts'
 *
 * Without a prefix, classification uses path heuristics:
 *   starts with '.', '/', '~'  →  local
 *   otherwise                   →  npm
 *
 * Builtins are resolved before this classifier runs (checked separately).
 */

import { resolve as resolvePath } from "node:path";
import { homedir } from "node:os";

const NPM_PREFIX = "npm:";
const FILE_PREFIX = "file:";

export type PluginKindType = "local" | "npm";

export interface PluginKind {
	readonly type: PluginKindType;
	readonly specifier: string;
}

/**
 * Classify a non-builtin plugin kind string into a resolved PluginKind.
 *
 * @param kind - raw kind string from WORKFLOW.md (after builtin check)
 * @param cwd - working directory for resolving relative paths
 */
export function classifyPluginKind(kind: string, cwd: string): PluginKind {
	if (kind.startsWith(NPM_PREFIX)) {
		return { type: "npm", specifier: kind.slice(NPM_PREFIX.length) };
	}

	if (kind.startsWith(FILE_PREFIX)) {
		return { type: "local", specifier: expandPath(kind.slice(FILE_PREFIX.length), cwd) };
	}

	if (isLocalPath(kind)) {
		return { type: "local", specifier: expandPath(kind, cwd) };
	}

	return { type: "npm", specifier: kind };
}

function isLocalPath(kind: string): boolean {
	return kind.startsWith(".")
		|| kind.startsWith("/")
		|| kind.startsWith("~");
}

function expandPath(path: string, cwd: string): string {
	if (path.startsWith("~")) {
		return resolvePath(homedir(), path.slice(path.startsWith("~/") ? 2 : 1));
	}
	return resolvePath(cwd, path);
}
