import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Data, Effect, Layer, Schema, ServiceMap } from "effect";
import {
	Comment,
	GithubPullRequestData,
	ReviewComment,
} from "./domain/github-comment.js";

const execFileAsync = promisify(execFile);

const PullRequestDataFromJson =
	Schema.decodeUnknownSync(GithubPullRequestData);

export class GithubCli extends ServiceMap.Service<GithubCli>()(
	"plot/Github/Cli",
	{
		make: Effect.gen(function* () {
			const { stdout: rawNameWithOwner } = yield* Effect.tryPromise({
				try: () =>
					execFileAsync("gh", [
						"repo",
						"view",
						"--json",
						"nameWithOwner",
						"-q",
						".nameWithOwner",
					]),
				catch: () => new GithubCliRepoNotFound(),
			});

			const nameWithOwner = rawNameWithOwner.trim();
			if (!nameWithOwner) {
				return yield* Effect.fail(new GithubCliRepoNotFound());
			}
			const [owner, repo] = nameWithOwner.split("/") as [string, string];

			const reviewComments = (pr: number) =>
				Effect.gen(function* () {
					const { stdout } = yield* Effect.tryPromise({
						try: () =>
							execFileAsync("gh", [
								"api",
								"graphql",
								"-f",
								`owner=${owner}`,
								"-f",
								`repo=${repo}`,
								"-F",
								`pr=${pr}`,
								"-f",
								`query=${githubReviewCommentsQuery}`,
							]),
						catch: (e) =>
							new GithubCliError({
								message: `graphql query failed: ${e instanceof Error ? e.message : String(e)}`,
							}),
					});

					const parsed = JSON.parse(stdout);
					const data = PullRequestDataFromJson(parsed);

					const comments =
						data.data.repository.pullRequest.comments.nodes.filter(
							(c) => !c.isBot,
						);
					const reviews =
						data.data.repository.pullRequest.reviews.nodes.filter(
							(r) => r.body.trim().length > 0,
						);
					const reviewThreads =
						data.data.repository.pullRequest.reviewThreads.nodes;
					return { comments, reviews, reviewThreads } as const;
				});

			const prFeedbackMd = (pr: number) =>
				reviewComments(pr).pipe(
					Effect.map(({ comments, reviewThreads, reviews }) => {
						const eligibleReviewThreads = reviewThreads.filter(
							(thread) => thread.shouldDisplayThread,
						);

						if (
							comments.length === 0 &&
							eligibleReviewThreads.length === 0 &&
							reviews.length === 0
						) {
							return `No review comments found.`;
						}

						let content = `# PR feedback\n\nComments are rendered in XML format.`;

						if (eligibleReviewThreads.length > 0) {
							const reviewCommentsMd = eligibleReviewThreads
								.map((thread) =>
									renderReviewComments(
										thread.commentNodes[0]!,
										thread.commentNodes.slice(1),
									),
								)
								.join("\n\n");
							content += `\n\n## Review Comments\n\n${reviewCommentsMd}`;
						}

						if (reviews.length > 0) {
							const reviewsXml = reviews
								.map(
									(review) =>
										`<review author="${review.author.login}">\n  <body>${review.body}</body>\n</review>`,
								)
								.join("\n");
							content += `\n\n## Reviews\n\n<reviews>\n${reviewsXml}\n</reviews>`;
						}

						if (comments.length > 0) {
							const generalCommentsXml = comments
								.map((comment) => renderGeneralComment(comment))
								.join("\n");
							content += `\n\n## General Comments\n\n<comments>\n${generalCommentsXml}\n</comments>`;
						}

						return content;
					}),
				);

			return { owner, repo, reviewComments, prFeedbackMd } as const;
		}),
	},
) {
	static layer = Layer.effect(this, this.make);
}

export class GithubCliRepoNotFound extends Data.TaggedError(
	"GithubCliRepoNotFound",
) {
	readonly message =
		"GitHub repository not found. Ensure the current directory is inside a git repo with a GitHub remote.";
}

export class GithubCliError extends Data.TaggedError("GithubCliError")<{
	message: string;
}> {}

const renderReviewComments = (
	comment: ReviewComment,
	followup: Array<ReviewComment>,
) => `<comment author="${comment.author.login}" path="${comment.path}">
  <diffHunk><![CDATA[
${comment.diffHunk}
  ]]></diffHunk>
  ${comment.originalLine ? `<lineNumber>${comment.originalLine}</lineNumber>` : ""}
  <body>${comment.body}</body>${
		followup.length > 0
			? `\n\n  <followup>${followup
					.map(
						(fc) =>
							`\n    <comment author="${fc.author.login}">\n      <body>${fc.body}</body>\n    </comment>`,
					)
					.join("")}\n  </followup>`
			: ""
	}
</comment>`;

const renderGeneralComment = (
	comment: Comment,
) => `  <comment author="${comment.author.login}">
    <body>${comment.body}</body>
  </comment>`;

const githubReviewCommentsQuery = `
query FetchPRComments($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      url
      reviewDecision
      reviews(first: 100) {
        nodes {
          id
          author {
            login
          }
          body
        }
      }
      reviewThreads(first: 100) {
        nodes {
          isCollapsed
          isResolved
          comments(first: 100) {
            nodes {
              id
              author {
                login
              }
              body
              path
              originalLine
              diffHunk
              createdAt
            }
          }
        }
      }
      comments(first: 100) {
        nodes {
          id
          body
          author {
            login
          }
          createdAt
        }
      }
    }
  }
}
`;
