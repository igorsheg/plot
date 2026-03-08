import { Schema } from "effect";

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
	priority: Schema.NullOr(Schema.Int),
	state: Schema.String,
	branchName: Schema.NullOr(Schema.String),
	url: Schema.NullOr(Schema.String),
	labels: Schema.Array(Schema.String),
	blockedBy: Schema.Array(BlockerRef),
	createdAt: Schema.NullOr(Schema.DateTimeUtc),
	updatedAt: Schema.NullOr(Schema.DateTimeUtc),
}) {}

export class IssueStateEntry extends Schema.Class<IssueStateEntry>(
	"IssueStateEntry",
)({
	id: Schema.String,
	state: Schema.String,
}) {}
