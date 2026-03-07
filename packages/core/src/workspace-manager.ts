import { Effect } from "effect"
import { FileSystem, Command, CommandExecutor } from "@effect/platform"
import { WorkspaceError } from "@plot/contracts"
import type { ResolvedConfig } from "./config-service.js"
import { resolve } from "node:path"

const sanitizeWorkspaceKey = (identifier: string): string =>
  identifier.replace(/[^A-Za-z0-9._-]/g, "_")

export class WorkspaceManager extends Effect.Service<WorkspaceManager>()("WorkspaceManager", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const executor = yield* CommandExecutor.CommandExecutor

    const runHook = (
      script: string,
      cwd: string,
      timeoutMs: number,
    ): Effect.Effect<void, WorkspaceError> =>
      Effect.scoped(
        executor.start(Command.make("sh", "-lc", script).pipe(Command.workingDirectory(cwd))).pipe(
          Effect.flatMap((process) => process.exitCode),
          Effect.timeout(`${timeoutMs} millis`),
          Effect.flatMap((exitCode) =>
            exitCode === 0
              ? Effect.void
              : Effect.fail(
                  new WorkspaceError({ code: "hook_failed", message: `Hook exited ${exitCode}` }),
                ),
          ),
          Effect.mapError((e) =>
            e instanceof WorkspaceError
              ? e
              : new WorkspaceError({ code: "hook_error", message: String(e) }),
          ),
        ),
      )

    const ensureWorkspace = (
      identifier: string,
      config: ResolvedConfig,
    ): Effect.Effect<{ path: string; createdNow: boolean }, WorkspaceError> =>
      Effect.gen(function* () {
        const key = sanitizeWorkspaceKey(identifier)
        const wsPath = resolve(config.workspaceRoot, key)

        const rootAbs = resolve(config.workspaceRoot)
        if (!wsPath.startsWith(rootAbs)) {
          return yield* new WorkspaceError({
            code: "path_escape",
            message: "Workspace path escapes root",
            path: wsPath,
          })
        }

        const exists = yield* fs
          .exists(wsPath)
          .pipe(
            Effect.mapError((e) => new WorkspaceError({ code: "fs_check", message: String(e) })),
          )

        if (!exists) {
          yield* fs
            .makeDirectory(wsPath, { recursive: true })
            .pipe(
              Effect.mapError(
                (e) =>
                  new WorkspaceError({ code: "mkdir_failed", message: String(e), path: wsPath }),
              ),
            )

          if (config.hooksAfterCreate) {
            yield* runHook(config.hooksAfterCreate, wsPath, config.hooksTimeoutMs).pipe(
              Effect.catchAll((e) =>
                Effect.gen(function* () {
                  yield* fs.remove(wsPath, { recursive: true }).pipe(Effect.ignore)
                  return yield* Effect.fail(e)
                }),
              ),
            )
          }

          yield* Effect.logInfo("workspace_ready").pipe(
            Effect.annotateLogs({ identifier, workspace: wsPath, created: "true" }),
          )
          return { path: wsPath, createdNow: true }
        }

        yield* Effect.logDebug("workspace_ready").pipe(
          Effect.annotateLogs({ identifier, workspace: wsPath, created: "false" }),
        )
        return { path: wsPath, createdNow: false }
      })

    const removeWorkspace = (
      identifier: string,
      config: ResolvedConfig,
    ): Effect.Effect<void, WorkspaceError> =>
      Effect.gen(function* () {
        const key = sanitizeWorkspaceKey(identifier)
        const wsPath = resolve(config.workspaceRoot, key)

        const rootAbs = resolve(config.workspaceRoot)
        if (!wsPath.startsWith(rootAbs)) {
          return yield* new WorkspaceError({
            code: "path_escape",
            message: "Workspace path escapes root",
            path: wsPath,
          })
        }

        const exists = yield* fs
          .exists(wsPath)
          .pipe(
            Effect.mapError((e) => new WorkspaceError({ code: "fs_check", message: String(e) })),
          )
        if (!exists) return

        if (config.hooksBeforeRemove) {
          yield* runHook(config.hooksBeforeRemove, wsPath, config.hooksTimeoutMs).pipe(
            Effect.ignore,
          )
        }

        yield* fs
          .remove(wsPath, { recursive: true })
          .pipe(
            Effect.mapError(
              (e) => new WorkspaceError({ code: "rm_failed", message: String(e), path: wsPath }),
            ),
          )

        yield* Effect.logInfo("workspace_removed").pipe(
          Effect.annotateLogs({ identifier, workspace: wsPath }),
        )
      })

    return { ensureWorkspace, removeWorkspace, runHook }
  }),
}) {}
