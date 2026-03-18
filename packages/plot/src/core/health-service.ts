import { Duration, Effect, FileSystem, Layer, ServiceMap, Schema } from "effect";
import { TrackerClient } from "@plot/sdk";
import { WorkflowLoader } from "./workflow-loader.js";
import { resolve } from "node:path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

// Health check response schemas
export const HealthStatus = Schema.Literals(["ok", "degraded", "unhealthy"]);
export type HealthStatus = typeof HealthStatus.Type;

export class HealthCheck extends Schema.Class<HealthCheck>("HealthCheck")({
  status: HealthStatus,
  latencyMs: Schema.optional(Schema.Number),
  trackerKind: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
}) {}

export class HealthResponse extends Schema.Class<HealthResponse>("HealthResponse")({
  status: HealthStatus,
  uptime: Schema.Number,
  checks: Schema.Struct({
    tracker: HealthCheck,
    workspace: HealthCheck,
    workflow: HealthCheck,
  }),
}) {}

export class HealthService extends ServiceMap.Service<HealthService>()(
  "HealthService",
  {
    make: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const checkTracker = Effect.gen(function* () {
        const start = Date.now();
        const trackerClient = yield* Effect.serviceOption(TrackerClient);
        
        if (!trackerClient._tag || trackerClient._tag !== "Some") {
          return new HealthCheck({
            status: "unhealthy",
            error: "Tracker client not available",
          });
        }

        try {
          // Check if this is a GitHub or Beads tracker by checking environment
          const githubRepo = process.env["GITHUB_REPO"];
          if (githubRepo) {
            // GitHub tracker - check rate limit
            yield* Effect.scoped(
              spawner
                .spawn(ChildProcess.make("gh", ["api", "rate_limit"]))
                .pipe(
                  Effect.flatMap((process) => process.exitCode),
                  Effect.timeout(Duration.seconds(5)),
                )
            );
            const latencyMs = Date.now() - start;
            return new HealthCheck({
              status: "ok",
              latencyMs,
              trackerKind: "github",
            });
          } else {
            // Beads tracker - check bd list
            yield* Effect.scoped(
              spawner
                .spawn(ChildProcess.make("bd", ["list"]))
                .pipe(
                  Effect.flatMap((process) => process.exitCode),
                  Effect.timeout(Duration.seconds(5)),
                )
            );
            const latencyMs = Date.now() - start;
            return new HealthCheck({
              status: "ok",
              latencyMs,
              trackerKind: "beads",
            });
          }
        } catch (error) {
          return new HealthCheck({
            status: "unhealthy",
            error: `Tracker check failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }).pipe(
        Effect.timeout(Duration.seconds(5)),
        Effect.catch(() =>
          Effect.succeed(
            new HealthCheck({
              status: "unhealthy",
              error: "Tracker timeout or error",
            })
          )
        )
      );

      const checkWorkspace = Effect.gen(function* () {
        try {
          // Check if workspace root directory exists and is writable
          const workspaceRoot = process.env["PLOT_WORKSPACE_ROOT"] || "./workspaces";
          const resolvedRoot = resolve(workspaceRoot);
          
          const exists = yield* fs.exists(resolvedRoot).pipe(
            Effect.timeout(Duration.seconds(5))
          );
          
          if (!exists) {
            return new HealthCheck({
              status: "unhealthy",
              error: "Workspace root directory does not exist",
            });
          }

          // Test write access by creating a temporary file
          const testFile = resolve(resolvedRoot, ".health_check_test");
          yield* fs.writeFileString(testFile, "test").pipe(
            Effect.timeout(Duration.seconds(2))
          );
          yield* fs.remove(testFile).pipe(
            Effect.timeout(Duration.seconds(2)),
            Effect.ignore
          );

          return new HealthCheck({ status: "ok" });
        } catch (error) {
          return new HealthCheck({
            status: "unhealthy",
            error: `Workspace check failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }).pipe(
        Effect.timeout(Duration.seconds(5)),
        Effect.catch(() =>
          Effect.succeed(
            new HealthCheck({
              status: "unhealthy", 
              error: "Workspace timeout or error",
            })
          )
        )
      );

      const checkWorkflow = Effect.gen(function* () {
        try {
          const workflowLoader = yield* Effect.serviceOption(WorkflowLoader);
          
          if (!workflowLoader._tag || workflowLoader._tag !== "Some") {
            return new HealthCheck({
              status: "unhealthy",
              error: "Workflow loader not available",
            });
          }

          const snapshot = yield* workflowLoader.value.getSnapshot.pipe(
            Effect.timeout(Duration.seconds(5))
          );
          
          if (!snapshot.definition) {
            return new HealthCheck({
              status: "unhealthy",
              error: "No workflow definition loaded",
            });
          }

          // Determine tracker kind from environment
          const githubRepo = process.env["GITHUB_REPO"];
          const trackerKind = githubRepo ? "github" : "beads";

          return new HealthCheck({ 
            status: "ok",
            trackerKind,
          });
        } catch (error) {
          return new HealthCheck({
            status: "unhealthy",
            error: `Workflow check failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }).pipe(
        Effect.timeout(Duration.seconds(5)),
        Effect.catch(() =>
          Effect.succeed(
            new HealthCheck({
              status: "unhealthy",
              error: "Workflow timeout or error",
            })
          )
        )
      );

      const performHealthCheck = (startedAt: number) =>
        Effect.gen(function* () {
          // Run all checks in parallel
          const results = yield* Effect.all({
            tracker: checkTracker,
            workspace: checkWorkspace,
            workflow: checkWorkflow,
          }, { concurrency: "unbounded" });

          const checks = {
            tracker: results.tracker,
            workspace: results.workspace,
            workflow: results.workflow,
          };

          // Determine overall status
          const criticalChecks = [checks.tracker, checks.workflow];
          const allChecks = [checks.tracker, checks.workspace, checks.workflow];

          const hasCriticalFailure = criticalChecks.some((check) => check?.status === "unhealthy");
          const hasAnyFailure = allChecks.some((check) => check?.status !== "ok");

          const overallStatus = hasCriticalFailure
            ? "unhealthy"
            : hasAnyFailure
            ? "degraded"
            : "ok";

          const uptime = Math.floor((Date.now() - startedAt) / 1000);

          return new HealthResponse({
            status: overallStatus,
            uptime,
            checks,
          });
        });

      return { performHealthCheck };
    }),
  },
) {
  static layer = Layer.effect(this, this.make);
}