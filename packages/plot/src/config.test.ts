import { describe, expect, test } from "bun:test";
import { ConfigProvider, Effect } from "effect";
import { ServerConfig, parseWorkflowFrontmatter } from "./config.js";

function resolveConfig(env: Record<string, string>) {
  const provider = ConfigProvider.fromMap(new Map(Object.entries(env)), {
    pathDelim: "_",
  });
  return Effect.runPromise(ServerConfig.pipe(Effect.withConfigProvider(provider)));
}

describe("ServerConfig", () => {
  test("reads explicit web config from env", async () => {
    const config = await resolveConfig({
      PLOT_PORT: "4123",
      PLOT_WEB_DIST_DIR: "/tmp/plot-web",
      PLOT_WEB_ENABLED: "true",
    });

    expect(config.port).toBe(4123);
    expect(config.webDistDir).toBe("/tmp/plot-web");
    expect(config.webEnabled).toBe(true);
  });

  test("uses defaults when env is missing", async () => {
    const config = await resolveConfig({});

    expect(config.workflowPath).toBe("./WORKFLOW.md");
    expect(config.port).toBe(3000);
    expect(config.webEnabled).toBe(false);
    expect(config.logFormat).toBe("pretty");
    expect(config.logLevel).toBe("info");
    expect(config.overrides).toEqual({
      trackerKind: undefined,
      githubRepo: undefined,
    });
  });

  test("populates overrides only when env vars are set", async () => {
    const config = await resolveConfig({
      PLOT_TRACKER_KIND: "github",
      PLOT_GITHUB_REPO: "owner/repo",
    });

    expect(config.overrides.trackerKind).toBe("github");
    expect(config.overrides.githubRepo).toBe("owner/repo");
  });

  test("rejects invalid log format", async () => {
    await expect(resolveConfig({ PLOT_LOG_FORMAT: "yaml" })).rejects.toThrow();
  });

  test("rejects invalid log level", async () => {
    await expect(resolveConfig({ PLOT_LOG_LEVEL: "trace" })).rejects.toThrow();
  });

  test("rejects invalid port (out of range)", async () => {
    await expect(resolveConfig({ PLOT_PORT: "70000" })).rejects.toThrow();
  });

  test("rejects invalid port (not a number)", async () => {
    await expect(resolveConfig({ PLOT_PORT: "wat" })).rejects.toThrow();
  });
});

describe("parseWorkflowFrontmatter", () => {
  test("parses github tracker config", () => {
    const content = `---
tracker:
  kind: github
  dispatch_states:
    - Todo
    - In Progress
---
template content`;

    const config = parseWorkflowFrontmatter(content);
    expect(config.tracker?.kind).toBe("github");
    expect(config.tracker?.dispatchStates).toEqual(["Todo", "In Progress"]);
  });

  test("returns empty config for no frontmatter", () => {
    const config = parseWorkflowFrontmatter("just template");
    expect(config.tracker).toBeUndefined();
  });
});
