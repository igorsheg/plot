import { Data, Effect, ServiceMap } from "effect"

export class GitFlowError extends Data.TaggedError("GitFlowError")<{
	message: string
}> {}

export interface GitFlowShape {
	readonly requiresGithubPr: boolean
	readonly branch: string | undefined
	readonly setupInstructions: (options: {
		readonly githubPrNumber: number | undefined
	}) => string
	readonly commitInstructions: (options: {
		readonly githubPrNumber: number | undefined
		readonly targetBranch: string | undefined
		readonly taskId: string
	}) => string
	readonly reviewInstructions: string
	readonly postWork: (options: {
		readonly targetBranch: string | undefined
		readonly issueId: string
	}) => Effect.Effect<void, GitFlowError>
	readonly autoMerge: (options: {
		readonly targetBranch: string | undefined
		readonly issueId: string
	}) => Effect.Effect<void, GitFlowError>
}

export class GitFlow extends ServiceMap.Service<
	GitFlow,
	GitFlowShape
>()("plot/GitFlow") {}
