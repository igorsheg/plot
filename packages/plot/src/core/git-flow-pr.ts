import { Effect, Layer } from "effect"
import { GitFlow } from "./git-flow.js"

export const GitFlowPR: Layer.Layer<GitFlow> = Layer.succeed(
	GitFlow,
	GitFlow.of({
		requiresGithubPr: true,
		branch: undefined,
		setupInstructions: ({ githubPrNumber }) =>
			githubPrNumber
				? `Github PR #${githubPrNumber} detected, branch checked out. Review all feedback.`
				: `On a new branch for this task. No need to checkout other branches.`,
		commitInstructions: (options) =>
			!options.githubPrNumber
				? `Create a pull request for this task.${options.targetBranch ? ` Target branch: \`${options.targetBranch}\`.` : ""}`
				: `Commit and push changes to the PR.${options.targetBranch ? ` Target branch: \`${options.targetBranch}\`.` : ""}`,
		reviewInstructions: `On the PR branch with their changes. After changes, commit and push to same PR.`,
		postWork: () => Effect.void,
		autoMerge: () => Effect.void,
	}),
)
