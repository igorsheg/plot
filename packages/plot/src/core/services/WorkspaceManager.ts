import type { Effect } from "effect";
import { ServiceMap } from "effect";
import type { WorkspaceError } from "../errors.js";
import type { ResolvedConfig } from "../config-service.js";

export interface WorkspaceManagerShape {
	readonly ensureWorkspace: (
		identifier: string,
		config: ResolvedConfig,
	) => Effect.Effect<{ path: string; createdNow: boolean }, WorkspaceError>;
	readonly removeWorkspace: (
		identifier: string,
		config: ResolvedConfig,
	) => Effect.Effect<void, WorkspaceError>;
	readonly runHook: (
		script: string,
		cwd: string,
		timeoutMs: number,
	) => Effect.Effect<void, WorkspaceError>;
}

export class WorkspaceManager extends ServiceMap.Service<WorkspaceManager, WorkspaceManagerShape>()(
	"WorkspaceManager",
) {}
