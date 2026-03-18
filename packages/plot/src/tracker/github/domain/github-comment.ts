import { Schema } from "effect";

export class Author extends Schema.Class<Author>("Author")({
	login: Schema.String,
}) {}

const commonBotUserPrefixes = [
	"dependabot",
	"github",
	"changeset",
	"renovate",
	"snyk",
	"coderabbit",
];

export class Comment extends Schema.Class<Comment>("Comment")({
	id: Schema.String,
	body: Schema.String,
	author: Author,
	createdAt: Schema.String,
}) {
	get isBot() {
		const login = this.author.login.toLowerCase();
		return commonBotUserPrefixes.some((prefix) => login.startsWith(prefix));
	}
}

export class PullRequestComments extends Schema.Class<PullRequestComments>(
	"PullRequestComments",
)({
	nodes: Schema.Array(Comment),
}) {}

export class Review extends Schema.Class<Review>("Review")({
	id: Schema.String,
	author: Author,
	body: Schema.String,
}) {}

export class Reviews extends Schema.Class<Reviews>("Reviews")({
	nodes: Schema.Array(Review),
}) {}

export class ReviewComment extends Schema.Class<ReviewComment>(
	"ReviewComment",
)({
	id: Schema.String,
	author: Author,
	body: Schema.String,
	path: Schema.String,
	originalLine: Schema.Number,
	diffHunk: Schema.String,
	createdAt: Schema.String,
}) {}

export class NodeComments extends Schema.Class<NodeComments>("NodeComments")({
	nodes: Schema.Array(ReviewComment),
}) {}

export class ReviewThreadsNode extends Schema.Class<ReviewThreadsNode>(
	"ReviewThreadsNode",
)({
	isCollapsed: Schema.Boolean,
	isResolved: Schema.Boolean,
	comments: NodeComments,
}) {
	readonly commentNodes = this.comments.nodes;
	readonly shouldDisplayThread = !this.isCollapsed && !this.isResolved;
}

export class ReviewThreads extends Schema.Class<ReviewThreads>(
	"ReviewThreads",
)({
	nodes: Schema.Array(ReviewThreadsNode),
}) {}

export class PullRequest extends Schema.Class<PullRequest>("PullRequest")({
	url: Schema.String,
	reviewDecision: Schema.NullOr(Schema.String),
	reviews: Reviews,
	reviewThreads: ReviewThreads,
	comments: PullRequestComments,
}) {}

export class Repository extends Schema.Class<Repository>("Repository")({
	pullRequest: PullRequest,
}) {}

export class GithubPullRequestDataInner extends Schema.Class<GithubPullRequestDataInner>(
	"GithubPullRequestDataInner",
)({
	repository: Repository,
}) {}

export class GithubPullRequestData extends Schema.Class<GithubPullRequestData>(
	"GithubPullRequestData",
)({
	data: GithubPullRequestDataInner,
}) {}
