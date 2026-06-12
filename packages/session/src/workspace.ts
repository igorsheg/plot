import { mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { TaggedError } from "better-result";

/**
 * Workspace manager (Symphony SPEC §9, adapted for Plot).
 *
 * The runtime guarantees only the safety-critical half of workspaces: a
 * durable directory per work key, created once and reused, provably inside
 * the configured root. Population (clone, checkout, dependencies) is owned
 * by the dispatched agent or workflow hooks, never by this module.
 */

export class PlotWorkspaceError extends TaggedError("PlotWorkspaceError")<{
	readonly phase: "config" | "ensure" | "remove";
	readonly message: string;
}>() {}

export interface WorkspaceManagerConfig {
	/** Workspace root. `~` expands; relative paths resolve against baseDir. */
	readonly root: string;
	/** Directory the root resolves against (the WORKFLOW.md directory). */
	readonly baseDir: string;
	/** Sub-namespace under the root, typically the workflow name. */
	readonly namespace: string;
	readonly cleanup?: "on_released" | "never";
}

export interface WorkspaceHandle {
	readonly path: string;
	readonly createdNow: boolean;
}

export interface WorkspaceManagerShape {
	readonly root: string;
	readonly cleanup: "on_released" | "never";
	readonly pathFor: (key: string) => string;
	readonly ensure: (key: string) => Promise<WorkspaceHandle>;
	readonly remove: (key: string) => Promise<void>;
}
export type WorkspaceManager = WorkspaceManagerShape;

/** Symphony §4.2: only [A-Za-z0-9._-] survives; everything else becomes _. */
export const sanitizeWorkspaceKey = (key: string): string => {
	const sanitized = key.replace(/[^A-Za-z0-9._-]/g, "_");
	// Defense in depth: a sanitized key cannot traverse, but never allow a
	// key that normalizes to nothing or to dot-only path segments.
	if (sanitized.length === 0 || /^\.+$/.test(sanitized))
		throw new PlotWorkspaceError({
			phase: "ensure",
			message: `workspace key sanitizes to an unusable value: ${JSON.stringify(key)}`,
		});
	return sanitized;
};

const expandRoot = (root: string, baseDir: string): string => {
	const expanded =
		root === "~"
			? homedir()
			: root.startsWith("~/")
				? resolve(homedir(), root.slice(2))
				: root;
	return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
};

/** Symphony §9.5 invariant 2: the workspace path must stay inside the root. */
const assertContained = (root: string, path: string): void => {
	if (path !== root && !path.startsWith(`${root}/`))
		throw new PlotWorkspaceError({
			phase: "ensure",
			message: `workspace path escapes root: ${path} is not under ${root}`,
		});
};

export const makeWorkspaceManager = (
	config: WorkspaceManagerConfig,
): WorkspaceManagerShape => {
	if (config.root.length === 0)
		throw new PlotWorkspaceError({
			phase: "config",
			message: "workspace root must be a non-empty path",
		});
	const namespace = sanitizeWorkspaceKey(config.namespace);
	const root = resolve(expandRoot(config.root, config.baseDir), namespace);
	const cleanup = config.cleanup ?? "never";
	const pathFor = (key: string): string => {
		const path = resolve(root, sanitizeWorkspaceKey(key));
		assertContained(root, path);
		return path;
	};
	return {
		root,
		cleanup,
		pathFor,
		ensure: async (key) => {
			const path = pathFor(key);
			const existing = await stat(path).catch(() => undefined);
			if (existing !== undefined) {
				if (!existing.isDirectory())
					throw new PlotWorkspaceError({
						phase: "ensure",
						message: `workspace path exists and is not a directory: ${path}`,
					});
				return { path, createdNow: false };
			}
			await mkdir(path, { recursive: true });
			return { path, createdNow: true };
		},
		remove: async (key) => {
			const path = pathFor(key);
			// pathFor re-asserts containment, so this delete cannot escape root.
			await rm(path, { recursive: true, force: true });
		},
	};
};

export const workspaceBaseDir = (
	workflowPath: string | undefined,
	cwd: string,
) => (workflowPath === undefined ? cwd : dirname(workflowPath));
