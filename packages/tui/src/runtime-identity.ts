import { basename } from "node:path";
import type { RuntimeIdentityProjection } from "@plot/session/projection";
import type { WorkflowDefinition } from "@plot/session/workflow";

export const runtimeIdentityFrom = (input: {
	readonly workflow: WorkflowDefinition;
	readonly cwd: string;
}): RuntimeIdentityProjection => {
	const { workflow, cwd } = input;
	const skills = workflow.runtime.resources?.skills ?? [];
	return {
		cwd,
		cwdName: basename(cwd),
		...(workflow.path === undefined ? {} : { workflowPath: workflow.path }),
		...(workflow.runtime.agent?.provider === undefined
			? {}
			: { provider: workflow.runtime.agent.provider }),
		...(workflow.runtime.agent?.model === undefined
			? {}
			: { model: workflow.runtime.agent.model }),
		...(workflow.runtime.agent?.thinking === undefined
			? {}
			: { thinking: workflow.runtime.agent.thinking }),
		skills: skills.map((skill) => basename(skill)),
		skillPaths: skills,
		...(workflow.runtime.plot?.tickIntervalMs === undefined
			? {}
			: { tickIntervalMs: workflow.runtime.plot.tickIntervalMs }),
		...(workflow.runtime.extension?.maxConcurrentRuns === undefined
			? {}
			: { maxConcurrentRuns: workflow.runtime.extension.maxConcurrentRuns }),
		...(workflow.runtime.plot?.maxRunDurationMs === undefined
			? {}
			: { maxRunDurationMs: workflow.runtime.plot.maxRunDurationMs }),
	};
};
