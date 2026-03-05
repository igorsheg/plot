import { Duration, Effect, Ref, Schema, Scope } from "effect";
import { FileSystem } from "@effect/platform";
import {
  WorkflowDefinition,
  WorkflowConfig,
  WorkflowFileNotFound,
  WorkflowParseError,
} from "@plot/shared";
import { parse as parseYaml } from "yaml";

const snakeToCamel = (s: string): string => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const transformKeys = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(transformKeys);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamel(k)] = transformKeys(v);
    }
    return result;
  }
  return obj;
};

export class WorkflowLoader extends Effect.Service<WorkflowLoader>()("WorkflowLoader", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const currentRef = yield* Ref.make<WorkflowDefinition | null>(null);
    const revisionRef = yield* Ref.make(0);
    const lastContentRef = yield* Ref.make<string | null>(null);

    const parseWorkflow = (
      content: string,
    ): Effect.Effect<WorkflowDefinition, WorkflowParseError> =>
      Effect.gen(function* () {
        const trimmed = content.trimStart();
        let configRaw: Record<string, unknown> = {};
        let promptTemplate = trimmed;

        if (trimmed.startsWith("---")) {
          const endIdx = trimmed.indexOf("\n---", 3);
          if (endIdx === -1) {
            return yield* new WorkflowParseError({ message: "Unterminated YAML front matter" });
          }
          const yamlBlock = trimmed.slice(3, endIdx);
          promptTemplate = trimmed.slice(endIdx + 4).trim();

          try {
            const parsed = parseYaml(yamlBlock);
            if (parsed === null || parsed === undefined) {
              configRaw = {};
            } else if (typeof parsed !== "object" || Array.isArray(parsed)) {
              return yield* new WorkflowParseError({ message: "Front matter must be a YAML map" });
            } else {
              configRaw = parsed as Record<string, unknown>;
            }
          } catch (e) {
            return yield* new WorkflowParseError({ message: `YAML parse error: ${e}` });
          }
        }

        const config = yield* Schema.decodeUnknown(WorkflowConfig)(transformKeys(configRaw)).pipe(
          Effect.mapError((e) => new WorkflowParseError({ message: `Config validation: ${e}` })),
        );

        return new WorkflowDefinition({ config, promptTemplate });
      });

    const load = (
      path: string,
    ): Effect.Effect<WorkflowDefinition, WorkflowFileNotFound | WorkflowParseError> =>
      Effect.gen(function* () {
        const exists = yield* fs
          .exists(path)
          .pipe(Effect.mapError(() => new WorkflowFileNotFound({ path })));
        if (!exists) {
          return yield* new WorkflowFileNotFound({ path });
        }

        const content = yield* fs
          .readFileString(path)
          .pipe(Effect.mapError(() => new WorkflowFileNotFound({ path })));

        const definition = yield* parseWorkflow(content);
        yield* Ref.set(currentRef, definition);
        yield* Ref.update(revisionRef, (n) => n + 1);
        yield* Ref.set(lastContentRef, content);
        return definition;
      });

    const startWatching = (path: string): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const poll = Effect.gen(function* () {
          const content = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => null));
          if (content === null) return;

          const prev = yield* Ref.get(lastContentRef);
          if (content === prev) return;

          const result = yield* parseWorkflow(content).pipe(Effect.either);
          if (result._tag === "Right") {
            yield* Ref.set(currentRef, result.right);
            yield* Ref.update(revisionRef, (n) => n + 1);
            yield* Ref.set(lastContentRef, content);
          } else {
            yield* Effect.logError("workflow_reload_failed").pipe(
              Effect.annotateLogs("path", path),
              Effect.annotateLogs("error", String(result.left)),
            );
          }
        });

        yield* poll
          .pipe(Effect.delay(Duration.seconds(5)), Effect.forever, Effect.forkScoped)
          .pipe(Effect.asVoid);
      });

    const getCurrent = Ref.get(currentRef);

    const getSnapshot = Effect.all({
      definition: Ref.get(currentRef),
      revision: Ref.get(revisionRef),
    });

    return { load, startWatching, getCurrent, getSnapshot };
  }),
}) {}
