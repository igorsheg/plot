import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { TrackerClient } from "./tracker-client.js";
import { makeGithubTracker } from "./github.js";
import { makeTrackerLayer } from "../runtime-builder.js";
import { ResolvedConfig } from "../core/config-service.js";
import { TrackerConfig, WorkflowConfig } from "../schemas/workflow.js";

const makeResolved = (kind: string, githubRepo?: string) =>
  new ResolvedConfig(
    new WorkflowConfig({
      tracker: new TrackerConfig({
        kind,
        dispatchStates: ["Todo", "In Progress"],
        terminalStates: ["Done"],
      }),
    }),
    githubRepo ? { githubRepo } : undefined,
  );

describe("tracker plugin system", () => {
  describe("config resolution", () => {
    test("resolves trackerKind from workflow config", () => {
      const resolved = makeResolved("github");
      expect(resolved.trackerKind).toBe("github");
    });

    test("resolves trackerKind from overrides", () => {
      const resolved = new ResolvedConfig(new WorkflowConfig({}), { trackerKind: "github" });
      expect(resolved.trackerKind).toBe("github");
    });

    test("overrides take precedence over workflow config", () => {
      const resolved = new ResolvedConfig(
        new WorkflowConfig({
          tracker: new TrackerConfig({ kind: "local-fs" }),
        }),
        { trackerKind: "github" },
      );
      expect(resolved.trackerKind).toBe("github");
    });

    test("defaults to local-fs when no tracker config", () => {
      const resolved = new ResolvedConfig(new WorkflowConfig({}));
      expect(resolved.trackerKind).toBe("local-fs");
    });
  });

  describe("builtin registry", () => {
    test("makeTrackerLayer returns a layer for github kind", () => {
      const resolved = makeResolved("github", "owner/repo");
      const layer = makeTrackerLayer(resolved);
      expect(layer).toBeDefined();
      expect(Layer.isLayer(layer)).toBeTrue();
    });

    test("makeTrackerLayer returns a layer for local-fs kind", () => {
      const resolved = makeResolved("local-fs");
      const layer = makeTrackerLayer(resolved);
      expect(layer).toBeDefined();
      expect(Layer.isLayer(layer)).toBeTrue();
    });

    test("github tracker is statically imported, not dynamically loaded", async () => {
      const trackerModule = await import("./index.js");
      expect(typeof trackerModule.makeGithubTracker).toBe("function");
    });
  });

  describe("github tracker layer", () => {
    test("makeGithubTracker produces a TrackerClient layer", () => {
      const layer = makeGithubTracker({ repo: "owner/repo" });
      expect(layer).toBeDefined();
      expect(Layer.isLayer(layer)).toBeTrue();
    });

    test("TrackerClient service is resolvable from github tracker layer", async () => {
      const layer = makeGithubTracker({ repo: "owner/repo" });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* TrackerClient;
          expect(typeof client.fetchCandidateIssues).toBe("function");
          expect(typeof client.fetchIssuesByStates).toBe("function");
          expect(typeof client.fetchIssueStatesByIds).toBe("function");
          return true;
        }).pipe(Effect.provide(layer)),
      );

      expect(result).toBeTrue();
    });
  });

  describe("end-to-end wiring", () => {
    test("config with github kind wires TrackerClient through registry", async () => {
      const resolved = makeResolved("github", "owner/repo");
      const layer = makeTrackerLayer(resolved);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* TrackerClient;
          expect(typeof client.fetchCandidateIssues).toBe("function");
          expect(typeof client.fetchIssuesByStates).toBe("function");
          expect(typeof client.fetchIssueStatesByIds).toBe("function");
          return true;
        }).pipe(Effect.provide(layer)),
      );

      expect(result).toBeTrue();
    });

    test("dispatch states flow through from config to resolved", () => {
      const resolved = makeResolved("github");
      expect(resolved.dispatchStates).toEqual(["Todo", "In Progress"]);
    });

    test("terminal states flow through from config to resolved", () => {
      const resolved = makeResolved("github");
      expect(resolved.terminalStates).toEqual(["Done"]);
    });

    test("githubRepo is passed through to resolved config", () => {
      const resolved = makeResolved("github", "igorsheg/plot");
      expect(resolved.githubRepo).toBe("igorsheg/plot");
    });
  });
});
