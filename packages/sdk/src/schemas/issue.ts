import { Schema } from "effect";
import type { IssueLike } from "../plugin/types.js";
import type { IssueStateEntryLike } from "../plugin/types.js";

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

/** Compile-time proof: Issue fields must stay in sync with IssueLike. */
export type _IssueEncodedMatchesIssueLike = typeof Issue.Encoded extends IssueLike ? true : never;

export class IssueStateEntry extends Schema.Class<IssueStateEntry>("IssueStateEntry")({
	id: Schema.String,
	state: Schema.String,
}) {}

/** Compile-time proof: IssueStateEntry fields must stay in sync with IssueStateEntryLike. */
export type _IssueStateEntryMatchesLike = typeof IssueStateEntry.Encoded extends IssueStateEntryLike ? true : never;
