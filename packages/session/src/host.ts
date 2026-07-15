import { basename } from "node:path";
import { loadPlotExtensionRuntimeFromWorkflow } from "./extension-loader.js";
import { makePlotExtensionSourceBundle } from "./extension-source.js";
import { sessionEventLogPath, type SessionPaths } from "./paths.js";
import { makeCreatePiAgentSession } from "./pi-session.js";
import { makePiWorkRunner, type CreatePiAgentSession } from "./pi-runner.js";
import { loadWorkflowForSession } from "./preparation.js";
import {
	makeSessionEventOwner,
	makeSessionRuntime,
	type SessionRuntime,
} from "./runtime.js";
import type { WorkflowDefinition } from "./workflow.js";

export interface SessionHostMetadata {
	readonly workflowName: string;
	readonly workflowPath: string;
	readonly cwd: string;
	readonly cwdName: string;
	readonly sessionDir: string;
	readonly historyPath: string;
}

export interface SessionHost {
	readonly runtime: SessionRuntime;
	readonly paths: SessionPaths;
	readonly workflow: WorkflowDefinition;
	readonly metadata: SessionHostMetadata;
	readonly shutdown: () => Promise<void>;
}

export interface CreateSessionHostOptions {
	readonly cwd: string;
	readonly workflowPath?: string;
	readonly sessionId?: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
	readonly createAgentSession?: CreatePiAgentSession;
}

export const createSessionHost = async (
	options: CreateSessionHostOptions,
): Promise<SessionHost> => {
	const { paths, workflow } = await loadWorkflowForSession({
		...options,
		skipAgentReadiness: options.createAgentSession !== undefined,
	});
	const loaded = await loadPlotExtensionRuntimeFromWorkflow({
		workflow,
		paths,
	});
	const bundle = makePlotExtensionSourceBundle({
		extension: loaded.extension,
		runtime: loaded.runtime,
		credentials: loaded.credentials,
		workflow,
		paths,
		config: loaded.config,
		maxConcurrentRuns: workflow.runtime.extension.maxConcurrentRuns ?? 1,
	});
	const sessionId = options.sessionId ?? crypto.randomUUID();
	const historyPath = sessionEventLogPath(paths.sessionDir, sessionId);
	const events = makeSessionEventOwner({
		id: sessionId,
		sessionFile: historyPath,
	});
	const runner = makePiWorkRunner({
		createAgentSession:
			options.createAgentSession ??
			makeCreatePiAgentSession({ workflow, paths }),
		prompt: workflow.prompt,
		create: bundle.createOptions,
		maxTurns: workflow.runtime.agent.maxTurns ?? 20,
		onEvent: ({ context, event }) =>
			events.appendAgentEvent({
				sourceId: context.sourceId,
				runId: context.run.runId,
				workKey: context.work.workKey,
				event,
			}),
	});
	const runtime = makeSessionRuntime({
		events,
		source: bundle,
		runner,
		tickIntervalMs: workflow.runtime.plot?.tickIntervalMs,
		maxRunDurationMs: workflow.runtime.plot?.maxRunDurationMs,
		stallTimeoutMs: workflow.runtime.plot?.stallTimeoutMs,
	});
	return {
		runtime,
		paths,
		workflow,
		metadata: {
			workflowName:
				workflow.runtime.name ??
				(workflow.path ? basename(workflow.path) : "workflow"),
			workflowPath: workflow.path ?? "WORKFLOW.md",
			cwd: paths.cwd,
			cwdName: basename(paths.cwd),
			sessionDir: paths.sessionDir,
			historyPath,
		},
		shutdown: runtime.shutdown,
	};
};
