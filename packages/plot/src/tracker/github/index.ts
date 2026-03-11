import { DateTime, Effect, Layer, Schema } from "effect";
import {
	Issue,
	IssueStateEntry,
	TrackerAuthError,
	TrackerClient,
	TrackerNetworkError,
	TrackerNotFoundError,
	TrackerRateLimitError,
	TrackerValidationError,
} from "@plot/sdk";
import type {
	PluginToolDefinition,
	TrackerPlugin,
	TrackerPluginHooks,
} from "@plot/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildTrackerRunContext } from "../../core/workpad-context.js";

const execFileAsync = promisify(execFile);

const normalizeState = (s: string): string => s.trim().toLowerCase();

const WORKPAD_TEMPLATE = `## Plot Workpad

### Plan

- [ ] 1. <task>

### Acceptance Criteria

- [ ] <criterion>

### Validation

- [ ] <test command>

### Latest Attempt Summary

- changed: <none>
- validated: <none>
- failed: <none>
- blocked: <none>

### Notes

- <durable context>`;

const GithubTrackerConfig = Schema.Struct({
	kind: Schema.String,
	githubRepo: Schema.optional(Schema.String),
	dispatchStates: Schema.optional(Schema.Array(Schema.String)),
	parkedStates: Schema.optional(Schema.Array(Schema.String)),
	terminalStates: Schema.optional(Schema.Array(Schema.String)),
});
type GithubTrackerConfig = typeof GithubTrackerConfig.Type;

const GhLabel = Schema.Struct({
	name: Schema.String,
});

const GhIssue = Schema.Struct({
	number: Schema.Number,
	title: Schema.String,
	body: Schema.NullOr(Schema.String),
	state: Schema.String,
	labels: Schema.Array(GhLabel),
	url: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
});

const GhIssueList = Schema.Array(GhIssue);

const GhIssueView = Schema.Struct({
	number: Schema.Number,
	state: Schema.String,
	labels: Schema.Array(GhLabel),
});

const GhComment = Schema.Struct({ body: Schema.String });
const GhComments = Schema.Array(GhComment);

const GhCommentResponse = Schema.Struct({
	id: Schema.Number,
	body: Schema.String,
});

const GhCommentWithId = Schema.Struct({
	id: Schema.Number,
	body: Schema.String,
});

const GhPrEntry = Schema.Struct({ number: Schema.Number, body: Schema.String });
const GhPrList = Schema.Array(GhPrEntry);

const GhReviewEntry = Schema.Struct({
	body: Schema.String,
	state: Schema.String,
	author: Schema.Struct({ login: Schema.String }),
});
const GhPrCommentEntry = Schema.Struct({
	body: Schema.String,
	author: Schema.Struct({ login: Schema.String }),
});
const GhPrDetail = Schema.Struct({
	reviews: Schema.optional(Schema.Array(GhReviewEntry)),
	comments: Schema.optional(Schema.Array(GhPrCommentEntry)),
});

const mapGhFailure = (
	error: unknown,
	resourceId?: string,
):
	| TrackerAuthError
	| TrackerNetworkError
	| TrackerNotFoundError
	| TrackerRateLimitError => {
	const message = error instanceof Error ? error.message : String(error);
	const stderr =
		typeof error === "object" && error !== null && "stderr" in error
			? String((error as { stderr?: unknown }).stderr ?? "")
			: "";
	const details = [message, stderr].filter(Boolean).join("\n");
	const normalized = details.toLowerCase();

	if (
		normalized.includes("authentication failed") ||
		normalized.includes("not logged into any github hosts") ||
		normalized.includes("gh auth login")
	) {
		return new TrackerAuthError({
			message: `gh authentication failed: ${details}`,
		});
	}

	if (
		normalized.includes("rate limit") ||
		normalized.includes("api rate limit exceeded")
	) {
		return new TrackerRateLimitError({
			message: `gh rate limited: ${details}`,
		});
	}

	if (
		resourceId &&
		(normalized.includes("could not resolve to an issue") ||
			normalized.includes("not found") ||
			normalized.includes("no issue found"))
	) {
		return new TrackerNotFoundError({
			message: `github issue not found: ${details}`,
			resourceId,
		});
	}

	return new TrackerNetworkError({ message: `gh command failed: ${details}` });
};

function createGithubOps(config: {
	repo?: string;
	allStates?: ReadonlyArray<string>;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}) {
	const allStates =
		config.allStates ??
		[
			...(config.dispatchStates ?? []),
			...(config.parkedStates ?? []),
			...(config.terminalStates ?? []),
		].filter((state, index, states) => states.indexOf(state) === index);
	const repoArgs = config.repo ? ["--repo", config.repo] : [];
	const ghFields = "number,title,body,state,labels,url,createdAt,updatedAt";

	const runGh = (
		args: ReadonlyArray<string>,
		options?: { resourceId?: string },
	) =>
		Effect.tryPromise({
			try: () =>
				execFileAsync("gh", args as string[], {
					maxBuffer: 50 * 1024 * 1024,
				}),
			catch: (error) => mapGhFailure(error, options?.resourceId),
		});

	const listIssues = (ghState: "open" | "closed" | "all") =>
		Effect.gen(function* () {
			const result = yield* runGh([
				"issue",
				"list",
				...repoArgs,
				"--state",
				ghState,
				"--json",
				ghFields,
				"--limit",
				"500",
			]);
			return yield* Schema.decodeUnknown(GhIssueList)(
				JSON.parse(result.stdout),
			).pipe(
				Effect.mapError(
					(error) =>
						new TrackerValidationError({
							message: `failed to parse gh issue list: ${error}`,
						}),
				),
			);
		});

	const viewIssue = (issueNumber: string) =>
		Effect.gen(function* () {
			const result = yield* runGh(
				[
					"issue",
					"view",
					issueNumber,
					...repoArgs,
					"--json",
					"number,state,labels",
				],
				{ resourceId: issueNumber },
			);
			return yield* Schema.decodeUnknown(GhIssueView)(
				JSON.parse(result.stdout),
			).pipe(
				Effect.mapError(
					(error) =>
						new TrackerValidationError({
							message: `failed to parse gh issue view: ${error}`,
						}),
				),
			);
		});

	const mapState = (gh: {
		labels: ReadonlyArray<{ readonly name: string }>;
		state: string;
	}) => {
		const labelNames = gh.labels.map((l) => normalizeState(l.name));
		for (const s of allStates) {
			if (labelNames.includes(normalizeState(s))) return s;
		}
		return gh.state === "OPEN" ? "" : "Closed";
	};

	const mapIssue = (gh: Schema.Schema.Type<typeof GhIssue>): Issue =>
		new Issue({
			id: String(gh.number),
			identifier: `#${gh.number}`,
			title: gh.title,
			description: gh.body,
			state: mapState(gh),
			url: gh.url,
			labels: gh.labels.map((l) => l.name.toLowerCase()),
			createdAt: gh.createdAt
				? DateTime.unsafeFromDate(new Date(gh.createdAt))
				: null,
			updatedAt: gh.updatedAt
				? DateTime.unsafeFromDate(new Date(gh.updatedAt))
				: null,
		});

	const transitionIssue = (
		issueId: string,
		fromState: string,
		toState: string,
	) =>
		Effect.gen(function* () {
			const terminalStates = new Set(
				(config.terminalStates ?? []).map(normalizeState),
			);
			const isToTerminal = terminalStates.has(normalizeState(toState));
			const isFromTerminal = terminalStates.has(normalizeState(fromState));

			if (isFromTerminal || normalizeState(fromState) === "closed") {
				yield* runGh(["issue", "reopen", issueId, ...repoArgs], {
					resourceId: issueId,
				});
			}

			const editArgs = ["issue", "edit", issueId, ...repoArgs];
			if (toState && normalizeState(toState) !== "closed") {
				editArgs.push("--add-label", toState);
			}
			if (fromState && normalizeState(fromState) !== "closed") {
				editArgs.push("--remove-label", fromState);
			}
			if (editArgs.length > 3 + repoArgs.length) {
				yield* runGh(editArgs, { resourceId: issueId });
			}

			if (isToTerminal) {
				yield* runGh(["issue", "close", issueId, ...repoArgs], {
					resourceId: issueId,
				});
			}
		});

	const addComment = (issueId: string, body: string) =>
		Effect.gen(function* () {
			if (!config.repo) {
				return { commentId: "0" };
			}
			const result = yield* runGh([
				"api",
				`repos/${config.repo}/issues/${issueId}/comments`,
				"-X",
				"POST",
				"-f",
				`body=${body}`,
			]);
			const parsed = yield* Schema.decodeUnknown(GhCommentResponse)(
				JSON.parse(result.stdout),
			).pipe(
				Effect.mapError(
					(error) =>
						new TrackerValidationError({
							message: `failed to parse comment response: ${error}`,
						}),
				),
			);
			return { commentId: String(parsed.id) };
		});

	const updateComment = (commentId: string, body: string) =>
		Effect.gen(function* () {
			if (!config.repo) return;
			yield* runGh([
				"api",
				`repos/${config.repo}/issues/comments/${commentId}`,
				"-X",
				"PATCH",
				"-f",
				`body=${body}`,
			]);
		});

	const linkPullRequest = (issueId: string, prUrl: string) =>
		Effect.gen(function* () {
			if (!config.repo) return;
			yield* addComment(issueId, `[plot] linked PR: ${prUrl}`);
		}).pipe(Effect.asVoid);

	const findWorkpadCommentId = (issueId: string) =>
		Effect.gen(function* () {
			if (!config.repo) return null;
			const result = yield* runGh([
				"api",
				`repos/${config.repo}/issues/${issueId}/comments`,
			]).pipe(
				Effect.catchAll(() => Effect.succeed({ stdout: "[]", stderr: "" })),
			);
			const comments = yield* Schema.decodeUnknown(
				Schema.Array(GhCommentWithId),
			)(JSON.parse(result.stdout)).pipe(
				Effect.orElseSucceed(
					() => [] as ReadonlyArray<{ id: number; body: string }>,
				),
			);
			const workpad = comments.find((c) =>
				c.body.startsWith("## Plot Workpad"),
			);
			return workpad ? String(workpad.id) : null;
		});

	const ensureWorkpadComment = (issueId: string) =>
		Effect.gen(function* () {
			const existingId = yield* findWorkpadCommentId(issueId);
			if (existingId) return;
			yield* addComment(issueId, WORKPAD_TEMPLATE);
		});

	return {
		runGh,
		listIssues,
		viewIssue,
		mapState,
		mapIssue,
		transitionIssue,
		addComment,
		updateComment,
		linkPullRequest,
		findWorkpadCommentId,
		ensureWorkpadComment,
	};
}

export const makeGithubTracker = (config: {
	repo?: string;
	allStates?: ReadonlyArray<string>;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}) => {
	const ops = createGithubOps(config);

	return Layer.succeed(
		TrackerClient,
		TrackerClient.of({
			fetchCandidateIssues: (dispatchStates) =>
				Effect.gen(function* () {
					const ghIssues = yield* ops.listIssues("open");
					const issues = ghIssues.map(ops.mapIssue);
					const normalized = new Set(dispatchStates.map(normalizeState));
					const candidates = issues.filter((i) =>
						normalized.has(normalizeState(i.state)),
					);
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
					const ghIssues = yield* ops.listIssues("all");
					const issues = ghIssues.map(ops.mapIssue);
					const normalized = new Set(states.map(normalizeState));
					return issues.filter((i) => normalized.has(normalizeState(i.state)));
				}),

			fetchIssueStatesByIds: (ids) =>
				Effect.gen(function* () {
					const effects = ids.map((id) =>
						ops.viewIssue(id).pipe(
							Effect.map(
								(gh) =>
									new IssueStateEntry({
										id: String(gh.number),
										state: ops.mapState(gh),
									}),
							),
							Effect.map((entry) => [entry] as const),
							Effect.catchTag("TrackerNotFoundError", () =>
								Effect.succeed([] as const),
							),
						),
					);
					const results = yield* Effect.all(effects, { concurrency: 5 });
					return results.flat();
				}),

			fetchRunContext: (issueId, state) => {
				if (!config.repo) {
					return Effect.succeed(null);
				}

				return Effect.gen(function* () {
					const commentsResult = yield* ops
						.runGh(["api", `repos/${config.repo}/issues/${issueId}/comments`])
						.pipe(
							Effect.catchAll(() =>
								Effect.succeed({ stdout: "[]", stderr: "" }),
							),
						);

					const comments = yield* Schema.decodeUnknown(GhComments)(
						JSON.parse(commentsResult.stdout),
					).pipe(
						Effect.orElseSucceed(
							() => [] as ReadonlyArray<Schema.Schema.Type<typeof GhComment>>,
						),
					);
					let workpad: string | null = null;
					const workpadComment = comments.find((c) =>
						c.body.startsWith("## Plot Workpad"),
					);
					if (workpadComment) workpad = workpadComment.body;

					let reviews: string | null = null;
					if (
						(config.dispatchStates ?? []).some(
							(dispatchState) =>
								normalizeState(dispatchState) === normalizeState(state),
						)
					) {
						const prSearchResult = yield* ops
							.runGh([
								"pr",
								"list",
								...(config.repo ? ["--repo", config.repo] : []),
								"--state",
								"open",
								"--json",
								"number,headRefName,body",
								"--limit",
								"50",
							])
							.pipe(
								Effect.catchAll(() =>
									Effect.succeed({ stdout: "[]", stderr: "" }),
								),
							);

						const prs = yield* Schema.decodeUnknown(GhPrList)(
							JSON.parse(prSearchResult.stdout),
						).pipe(
							Effect.orElseSucceed(
								() => [] as ReadonlyArray<Schema.Schema.Type<typeof GhPrEntry>>,
							),
						);
						const linkedPr = prs.find((pr) => pr.body?.includes(`#${issueId}`));
						if (linkedPr) {
							const reviewResult = yield* ops
								.runGh([
									"pr",
									"view",
									String(linkedPr.number),
									...(config.repo ? ["--repo", config.repo] : []),
									"--json",
									"reviews,comments",
								])
								.pipe(
									Effect.catchAll(() =>
										Effect.succeed({ stdout: "{}", stderr: "" }),
									),
								);

							const prData = yield* Schema.decodeUnknown(GhPrDetail)(
								JSON.parse(reviewResult.stdout),
							).pipe(
								Effect.orElseSucceed(
									() => ({}) as Schema.Schema.Type<typeof GhPrDetail>,
								),
							);
							const parts: string[] = [];
							if (prData.reviews?.length) {
								for (const r of prData.reviews) {
									if (r.body)
										parts.push(
											`**${r.author.login}** (${r.state}):\n${r.body}`,
										);
								}
							}
							if (prData.comments?.length) {
								for (const c of prData.comments) {
									if (c.body) parts.push(`**${c.author.login}**:\n${c.body}`);
								}
							}
							reviews = parts.length > 0 ? parts.join("\n\n---\n\n") : null;
						}
					}

					return buildTrackerRunContext({ workpad, reviewFeedback: reviews });
				});
			},

			transitionIssue: (issueId, fromState, toState) =>
				ops.transitionIssue(issueId, fromState, toState),
			addComment: (issueId, body) => ops.addComment(issueId, body),
			updateComment: (commentId, body) => ops.updateComment(commentId, body),
			linkPullRequest: (issueId, prUrl) => ops.linkPullRequest(issueId, prUrl),
		}),
	);
};

function makeGithubTools(
	config: GithubTrackerConfig,
): ReadonlyArray<PluginToolDefinition> {
	const ops = createGithubOps({
		repo: config.githubRepo,
		dispatchStates: config.dispatchStates,
		parkedStates: config.parkedStates,
		terminalStates: config.terminalStates,
	});

	return [
		{
			name: "github_transition_issue",
			description:
				"Transition a GitHub issue between workflow states by swapping labels. Handles terminal states (close) and reopening from closed. Use this instead of raw `gh issue edit` for state changes.",
			parameters: Schema.Struct({
				issueId: Schema.String.annotations({
					description: "The issue number as a string",
				}),
				fromState: Schema.String.annotations({
					description: "Current state label to remove",
				}),
				toState: Schema.String.annotations({
					description: "Target state label to add",
				}),
			}),
			execute: (args: unknown) => {
				const { issueId, fromState, toState } = args as {
					issueId: string;
					fromState: string;
					toState: string;
				};
				return ops
					.transitionIssue(issueId, fromState, toState)
					.pipe(
						Effect.map(() => ({ success: true, issueId, fromState, toState })),
					);
			},
		},
		{
			name: "github_add_comment",
			description:
				"Add a comment to a GitHub issue. Returns the new comment ID. Use for workpad updates and status reports.",
			parameters: Schema.Struct({
				issueId: Schema.String.annotations({
					description: "The issue number as a string",
				}),
				body: Schema.String.annotations({
					description: "Comment body in markdown",
				}),
			}),
			execute: (args: unknown) => {
				const { issueId, body } = args as { issueId: string; body: string };
				return ops.addComment(issueId, body);
			},
		},
		{
			name: "github_update_comment",
			description:
				"Update an existing GitHub issue comment by ID. Use to update workpad comments instead of creating duplicates.",
			parameters: Schema.Struct({
				commentId: Schema.String.annotations({
					description: "The comment ID to update",
				}),
				body: Schema.String.annotations({
					description: "Updated comment body in markdown",
				}),
			}),
			execute: (args: unknown) => {
				const { commentId, body } = args as {
					commentId: string;
					body: string;
				};
				return ops
					.updateComment(commentId, body)
					.pipe(Effect.map(() => ({ success: true, commentId })));
			},
		},
		{
			name: "github_link_pull_request",
			description:
				"Link a pull request to a GitHub issue by adding a comment. The PR body should still include `Resolves #<number>` for GitHub auto-close.",
			parameters: Schema.Struct({
				issueId: Schema.String.annotations({
					description: "The issue number as a string",
				}),
				prUrl: Schema.String.annotations({
					description: "Full URL of the pull request",
				}),
			}),
			execute: (args: unknown) => {
				const { issueId, prUrl } = args as { issueId: string; prUrl: string };
				return ops
					.linkPullRequest(issueId, prUrl)
					.pipe(Effect.map(() => ({ success: true, issueId, prUrl })));
			},
		},
	];
}

function makeGithubHooks(config: GithubTrackerConfig): TrackerPluginHooks {
	const ops = createGithubOps({
		repo: config.githubRepo,
		dispatchStates: config.dispatchStates,
		parkedStates: config.parkedStates,
		terminalStates: config.terminalStates,
	});

	return {
		onIssueDispatched: (issue) =>
			ops.ensureWorkpadComment(issue.id).pipe(
				Effect.catchAll((error) =>
					Effect.logWarning("workpad_ensure_failed").pipe(
						Effect.annotateLogs({
							issue_id: issue.id,
							error: String(error),
						}),
					),
				),
			),
		onAgentComplete: (_issue, _result) => Effect.void,
		onAgentFailed: (_issue, _error) => Effect.void,
	};
}

const plugin: TrackerPlugin<GithubTrackerConfig> = {
	name: "github",
	configSchema: GithubTrackerConfig,
	factory: (config) =>
		makeGithubTracker({
			repo: config.githubRepo,
			dispatchStates: config.dispatchStates,
			parkedStates: config.parkedStates,
			terminalStates: config.terminalStates,
		}),
	tools: (config) => makeGithubTools(config),
	hooks: (config) => makeGithubHooks(config),
};

export default plugin;
