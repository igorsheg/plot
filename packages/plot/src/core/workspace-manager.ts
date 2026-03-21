import { Effect, FileSystem, Layer, Schema, ServiceMap } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
export class WorkspaceError extends Schema.TaggedErrorClass<WorkspaceError>()("WorkspaceError", {
	code: Schema.String,
	message: Schema.String,
	path: Schema.optional(Schema.String),
}) {}
import type { ResolvedConfig } from "./config-service.js";
import { resolve } from "node:path";

const sanitizeWorkspaceKey = (identifier: string): string =>
	identifier.replace(/[^A-Za-z0-9._-]/g, "_");

const assertPathInsideRoot = (
	wsPath: string,
	root: string,
): Effect.Effect<void, WorkspaceError> => {
	const rootAbs = resolve(root);
	if (!wsPath.startsWith(rootAbs)) {
		return Effect.fail(
			new WorkspaceError({
				code: "path_escape",
				message: "Workspace path escapes root",
				path: wsPath,
			}),
		);
	}
	return Effect.void;
};

export class WorkspaceManager extends ServiceMap.Service<WorkspaceManager>()("WorkspaceManager", {
	make: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

		const runHook = (
			script: string,
			cwd: string,
			timeoutMs: number,
		): Effect.Effect<void, WorkspaceError> =>
			Effect.scoped(
				spawner.spawn(ChildProcess.make("sh", ["-lc", script], { cwd })).pipe(
					Effect.flatMap((process) => process.exitCode),
					Effect.timeout(`${timeoutMs} millis`),
					Effect.flatMap((exitCode) =>
						exitCode === 0
							? Effect.void
							: Effect.fail(
									new WorkspaceError({
										code: "hook_failed",
										message: `Hook exited ${exitCode}`,
									}),
								),
					),
					Effect.mapError((e) =>
						e instanceof WorkspaceError
							? e
							: new WorkspaceError({
									code: "hook_error",
									message: String(e),
								}),
					),
				),
			);

		const ensureWorkspace = Effect.fnUntraced(function* (
			identifier: string,
			config: ResolvedConfig,
		) {
			const key = sanitizeWorkspaceKey(identifier);
			const wsPath = resolve(config.workspaceRoot, key);

			yield* assertPathInsideRoot(wsPath, config.workspaceRoot);

			const exists = yield* fs
				.exists(wsPath)
				.pipe(Effect.mapError((e) => new WorkspaceError({ code: "fs_check", message: String(e) })));

			if (!exists) {
				yield* fs.makeDirectory(wsPath, { recursive: true }).pipe(
					Effect.mapError(
						(e) =>
							new WorkspaceError({
								code: "mkdir_failed",
								message: String(e),
								path: wsPath,
							}),
					),
				);

				if (config.hooksAfterCreate) {
					yield* runHook(config.hooksAfterCreate, wsPath, config.hooksTimeoutMs).pipe(
						Effect.catch(
							Effect.fnUntraced(function* (e) {
								yield* fs.remove(wsPath, { recursive: true }).pipe(Effect.ignore);
								return yield* Effect.fail(e);
							}),
						),
					);
				}

				yield* Effect.logInfo("workspace_ready").pipe(
					Effect.annotateLogs({
						identifier,
						workspace: wsPath,
						created: "true",
					}),
				);
				return { path: wsPath, createdNow: true };
			}

			yield* Effect.logDebug("workspace_ready").pipe(
				Effect.annotateLogs({
					identifier,
					workspace: wsPath,
					created: "false",
				}),
			);
			return { path: wsPath, createdNow: false };
		});

		const removeWorkspace = Effect.fnUntraced(function* (
			identifier: string,
			config: ResolvedConfig,
		) {
			const key = sanitizeWorkspaceKey(identifier);
			const wsPath = resolve(config.workspaceRoot, key);

			yield* assertPathInsideRoot(wsPath, config.workspaceRoot);

			const exists = yield* fs
				.exists(wsPath)
				.pipe(Effect.mapError((e) => new WorkspaceError({ code: "fs_check", message: String(e) })));
			if (!exists) return;

			if (config.hooksBeforeRemove) {
				yield* runHook(config.hooksBeforeRemove, wsPath, config.hooksTimeoutMs).pipe(Effect.ignore);
			}

			yield* fs.remove(wsPath, { recursive: true }).pipe(
				Effect.mapError(
					(e) =>
						new WorkspaceError({
							code: "rm_failed",
							message: String(e),
							path: wsPath,
						}),
				),
			);

			yield* Effect.logInfo("workspace_removed").pipe(
				Effect.annotateLogs({ identifier, workspace: wsPath }),
			);
		});

		return { ensureWorkspace, removeWorkspace, runHook };
	}),
}) {
	static layer = Layer.effect(this, this.make);
}
