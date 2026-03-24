import { Schema } from "effect";
import type { PluginIssue } from "../plugin/types.js";
import type { PluginIssueState } from "../plugin/types.js";

export class BlockerRef extends Schema.Class<BlockerRef>("BlockerRef")({
	id: Schema.NullOr(Schema.String),
	identifier: Schema.NullOr(Schema.String),
	state: Schema.NullOr(Schema.String),
}) {}

export class Issue extends Schema.Class<Issue>("Issue")({
	id: Schema.String,
	identifier: Schema.String,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	priority: Schema.optional(Schema.Int),
	state: Schema.String,
	branchName: Schema.optional(Schema.String),
	url: Schema.NullOr(Schema.String),
	labels: Schema.Array(Schema.String),
	blockedBy: Schema.optional(Schema.Array(BlockerRef)),
	autoMerge: Schema.optional(Schema.Boolean),
	metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
	createdAt: Schema.NullOr(Schema.String),
	updatedAt: Schema.NullOr(Schema.String),
}) {}

/** Compile-time proof: Issue fields must stay in sync with PluginIssue. */
export type _IssueEncodedMatchesPluginIssue = typeof Issue.Encoded extends PluginIssue ? true : never;

export class IssueStateEntry extends Schema.Class<IssueStateEntry>("IssueStateEntry")({
	id: Schema.String,
	state: Schema.String,
}) {}

/** Compile-time proof: IssueStateEntry fields must stay in sync with PluginIssueState. */
export type _IssueStateEntryMatchesPluginIssueState = typeof IssueStateEntry.Encoded extends PluginIssueState ? true : never;
