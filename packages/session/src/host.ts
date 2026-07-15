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
	type SessionRuntimeOptions,
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
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly stallTimeoutMs?: number;
}

export const createSessionHost = async (
	options: CreateSessionHostOptions,
): Promise<SessionHost> => {
	const prepared = await loadWorkflowForSession({
		...options,
		skipAgentReadiness: options.createAgentSession !== undefined,
	});
	const { paths, workflow } = prepared;
	const loaded = await loadPlotExtensionRuntimeFromWorkflow(prepared);
	let owned = false;
	try {
		const bundleOptions: Parameters<typeof makePlotExtensionSourceBundle>[0] = {
			extension: loaded.extension,
			runtime: loaded.runtime,
			credentials: loaded.credentials,
			workflow,
			paths,
			config: loaded.config,
		};
		const maxConcurrentRuns = workflow.runtime.extension.maxConcurrentRuns;
		if (maxConcurrentRuns !== undefined)
			(bundleOptions as { maxConcurrentRuns?: number }).maxConcurrentRuns =
				maxConcurrentRuns;
		const bundle = makePlotExtensionSourceBundle(bundleOptions);
		owned = true;
		const sessionId = options.sessionId ?? crypto.randomUUID();
		const historyPath = sessionEventLogPath(paths.sessionDir, sessionId);
		const events = makeSessionEventOwner({
			id: sessionId,
			sessionFile: historyPath,
		});
		const createAgentSession =
			options.createAgentSession ??
			makeCreatePiAgentSession({ workflow, paths });
		const runner = makePiWorkRunner({
			createAgentSession,
			prompt: workflow.prompt,
			create: (context) => bundle.createOptions(context),
			maxTurns: workflow.runtime.agent.maxTurns ?? 20,
			onEvent: async ({ context, event }) => {
				await events.appendAgentEvent({
					sourceId: context.sourceId,
					runId: context.run.runId,
					workKey: context.work.workKey,
					event,
				});
			},
		});
		const runtimeOptions: SessionRuntimeOptions = {
			events,
			source: bundle,
			runner,
		};
		const plot = workflow.runtime.plot;
		const tickIntervalMs = options.tickIntervalMs ?? plot?.tickIntervalMs;
		const maxRunDurationMs = options.maxRunDurationMs ?? plot?.maxRunDurationMs;
		const stallTimeoutMs = options.stallTimeoutMs ?? plot?.stallTimeoutMs;
		if (tickIntervalMs !== undefined)
			(runtimeOptions as { tickIntervalMs?: number }).tickIntervalMs =
				tickIntervalMs;
		if (maxRunDurationMs !== undefined)
			(runtimeOptions as { maxRunDurationMs?: number }).maxRunDurationMs =
				maxRunDurationMs;
		if (stallTimeoutMs !== undefined)
			(runtimeOptions as { stallTimeoutMs?: number }).stallTimeoutMs =
				stallTimeoutMs;
		const runtime = makeSessionRuntime(runtimeOptions);
		const metadata: SessionHostMetadata = {
			workflowName:
				workflow.runtime.name ??
				(workflow.path ? basename(workflow.path) : "workflow"),
			workflowPath: workflow.path ?? "WORKFLOW.md",
			cwd: paths.cwd,
			cwdName: basename(paths.cwd),
			sessionDir: paths.sessionDir,
			historyPath,
		};
		return {
			runtime,
			paths,
			workflow,
			metadata,
			shutdown: async () => {
				await runtime.shutdown();
			},
		};
	} catch (error) {
		if (!owned) {
			const controller = new AbortController();
			controller.abort();
			await Promise.resolve(
				loaded.runtime.shutdown?.({ signal: controller.signal }),
			).catch(() => undefined);
		}
		throw error;
	}
};
