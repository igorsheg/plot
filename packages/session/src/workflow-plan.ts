import type {
	ExtensionCredentials,
	Extension,
	Workflow,
	WorkflowDefinition,
} from "@plot/sdk";
import type { SessionPaths } from "./paths.js";
import type { CreateAgentSession } from "./agent-runner.js";

export interface WorkflowPlan extends Pick<
	WorkflowDefinition,
	"name" | "agent" | "prompt"
> {
	readonly plot: WorkflowDefinition["plot"];
	readonly extension: Extension;
	readonly extensionConfig: unknown;
	readonly maxConcurrentRuns: number;
	readonly definition: unknown;
}

export interface PreparedWorkflow {
	readonly identity: Workflow<unknown> | string;
	readonly plan: WorkflowPlan;
	readonly paths: SessionPaths;
	readonly credentials: ExtensionCredentials;
	readonly createAgentSession: CreateAgentSession;
	readonly dispose: () => Promise<void> | void;
}
