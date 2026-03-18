import { Effect, Layer } from "effect"
import { GitFlow } from "./git-flow.js"

export const GitFlowCommit: Layer.Layer<GitFlow> = Layer.succeed(
	GitFlow,
	GitFlow.of({
		requiresGithubPr: false,
		branch: undefined,
		setupInstructions: () =>
			`On a new branch for this task. No need to checkout other branches.`,
		commitInstructions: (options) =>
			`Commit changes to current branch. Include \`References ${options.taskId}\` in commit messages.${options.targetBranch ? ` Target: \`${options.targetBranch}\`.` : ""} Do not git push.`,
		reviewInstructions: `On the branch with their changes. Commit changes to same branch. Do not push.`,
		postWork: () => Effect.void,
		autoMerge: () => Effect.void,
	}),
)
