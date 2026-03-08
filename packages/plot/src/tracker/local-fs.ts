import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { Issue, IssueStateEntry, BlockerRef } from "../schemas/issue.js";
import { TrackerError } from "../schemas/errors.js";
import { TrackerClient } from "./tracker-client.js";

const parseYamlFrontmatter = (content: string): { meta: Record<string, unknown>; body: string } => {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { meta: {}, body: content };
  }
  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx === -1) {
    return { meta: {}, body: content };
  }
  const yamlBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trim();
  const meta: Record<string, unknown> = {};
  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();
    if (value === "null" || value === "") value = null;
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (typeof value === "string" && /^\d+$/.test(value)) value = parseInt(value, 10);
    else if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      try {
        value = JSON.parse(value);
      } catch {
        /* keep as string */
      }
    }
    meta[key] = value;
  }
  return { meta, body };
};

const normalizeState = (s: string): string => s.trim().toLowerCase();

const parseIssueFile = (filename: string, content: string): Issue | null => {
  const { meta, body } = parseYamlFrontmatter(content);
  const id = String(meta["id"] ?? filename.replace(/\.md$/, ""));
  const identifier = String(meta["identifier"] ?? id);
  const title = String(meta["title"] ?? "Untitled");
  const state = String(meta["state"] ?? "Todo");
  const priority = typeof meta["priority"] === "number" ? meta["priority"] : null;
  const labels = Array.isArray(meta["labels"])
    ? (meta["labels"] as Array<string>).map((l: string) => String(l).toLowerCase())
    : [];
  const blockedBy = Array.isArray(meta["blockedBy"])
    ? (meta["blockedBy"] as Array<Record<string, unknown>>).map(
        (b) =>
          new BlockerRef({
            id: b["id"] != null ? String(b["id"]) : null,
            identifier: b["identifier"] != null ? String(b["identifier"]) : null,
            state: b["state"] != null ? String(b["state"]) : null,
          }),
      )
    : [];

  return new Issue({
    id,
    identifier,
    title,
    description: body || null,
    priority,
    state,
    branchName: meta["branchName"] != null ? String(meta["branchName"]) : null,
    url: meta["url"] != null ? String(meta["url"]) : null,
    labels,
    blockedBy,
    createdAt: null,
    updatedAt: null,
  });
};

export const makeLocalFsTracker = (issuesDir: string) =>
  Layer.effect(
    TrackerClient,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const readAllIssues = Effect.gen(function* () {
        const exists = yield* fs.exists(issuesDir);
        if (!exists) return [] as Array<Issue>;

        const entries = yield* fs.readDirectory(issuesDir);
        const mdFiles = entries.filter((e) => e.endsWith(".md"));
        const issues: Array<Issue> = [];

        for (const file of mdFiles) {
          const content = yield* fs.readFileString(`${issuesDir}/${file}`);
          const issue = parseIssueFile(file, content);
          if (issue) issues.push(issue);
        }
        return issues;
      }).pipe(
        Effect.mapError((e) => new TrackerError({ code: "local_fs_read", message: String(e) })),
      );

      return TrackerClient.of({
        fetchCandidateIssues: (dispatchStates) =>
          Effect.gen(function* () {
            const issues = yield* readAllIssues;
            const normalized = new Set(dispatchStates.map(normalizeState));
            const candidates = issues.filter((i) => normalized.has(normalizeState(i.state)));
            yield* Effect.logDebug("tracker_fetch").pipe(
              Effect.annotateLogs({
                component: "tracker",
                operation: "fetch_candidates",
                total: String(issues.length),
                candidates: String(candidates.length),
                dispatch_states: dispatchStates.join(","),
              }),
            );
            return candidates;
          }),

        fetchIssuesByStates: (states) =>
          Effect.gen(function* () {
            const issues = yield* readAllIssues;
            const normalized = new Set(states.map(normalizeState));
            return issues.filter((i) => normalized.has(normalizeState(i.state)));
          }),

        fetchIssueStatesByIds: (ids) =>
          Effect.gen(function* () {
            const issues = yield* readAllIssues;
            const idSet = new Set(ids);
            return issues
              .filter((i) => idSet.has(i.id))
              .map((i) => new IssueStateEntry({ id: i.id, state: i.state }));
          }),
      });
    }),
  );
