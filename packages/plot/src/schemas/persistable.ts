import { Duration, Schema } from "effect";
import { Persistable, PersistedCache } from "effect/unstable/persistence";

/**
 * Cached snapshot of tracker issue metadata.
 * Primary key is the tracker kind (e.g. "beads", "github") so each
 * tracker type gets its own cache entry.
 */
export class TrackerIssuesSnapshot extends Persistable.Class<{
	payload: { readonly trackerKind: string };
}>()("plot/TrackerIssuesSnapshot", {
	primaryKey: (p) => p.trackerKind,
	success: Schema.Struct({
		issues: Schema.Array(
			Schema.Struct({
				id: Schema.String,
				identifier: Schema.String,
				title: Schema.String,
				state: Schema.String,
				labels: Schema.Array(Schema.String),
				updatedAt: Schema.NullOr(Schema.String),
			}),
		),
		fetchedAt: Schema.Number,
	}),
}) {}

/**
 * Cached parsed workflow configuration.
 * Single entry keyed by the workflow file path.
 */
export class WorkflowConfigSnapshot extends Persistable.Class<{
	payload: { readonly workflowPath: string };
}>()("plot/WorkflowConfigSnapshot", {
	primaryKey: (p) => p.workflowPath,
	success: Schema.Struct({
		trackerKind: Schema.String,
		dispatchStates: Schema.Array(Schema.String),
		parkedStates: Schema.Array(Schema.String),
		terminalStates: Schema.Array(Schema.String),
		pollIntervalMs: Schema.Number,
		maxConcurrentAgents: Schema.Number,
		parsedAt: Schema.Number,
	}),
}) {}

/** Standard TTL for tracker data: 5 minutes */
export const TRACKER_CACHE_TTL = Duration.minutes(5);

/** Standard TTL for workflow config: 30 seconds (config reload is cheap) */
export const WORKFLOW_CACHE_TTL = Duration.seconds(30);

export { PersistedCache, Persistable };
