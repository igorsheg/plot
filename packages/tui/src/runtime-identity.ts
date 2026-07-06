import { basename } from "node:path";
import type { Mutable } from "@plot/common/primitives";
import type { RuntimeIdentityProjection } from "@plot/projection";
import type { WorkflowDefinition } from "@plot/session/workflow";

export const runtimeIdentityFrom = (input: {
	readonly workflow: WorkflowDefinition;
	readonly cwd: string;
}): RuntimeIdentityProjection => {
	const { workflow, cwd } = input;
	const skills = workflow.runtime.resources?.skills ?? [];
	const identity: Mutable<RuntimeIdentityProjection> = {
		cwd,
		cwdName: basename(cwd),
		skills: skills.map((skill) => basename(skill)),
		skillPaths: skills,
	};
	if (workflow.path !== undefined) identity.workflowPath = workflow.path;
	if (workflow.runtime.agent?.provider !== undefined)
		identity.provider = workflow.runtime.agent.provider;
	if (workflow.runtime.agent?.model !== undefined)
		identity.model = workflow.runtime.agent.model;
	if (workflow.runtime.agent?.thinking !== undefined)
		identity.thinking = workflow.runtime.agent.thinking;
	if (workflow.runtime.plot?.tickIntervalMs !== undefined)
		identity.tickIntervalMs = workflow.runtime.plot.tickIntervalMs;
	if (workflow.runtime.extension?.maxConcurrentRuns !== undefined)
		identity.maxConcurrentRuns = workflow.runtime.extension.maxConcurrentRuns;
	if (workflow.runtime.plot?.maxRunDurationMs !== undefined)
		identity.maxRunDurationMs = workflow.runtime.plot.maxRunDurationMs;
	return identity;
};
