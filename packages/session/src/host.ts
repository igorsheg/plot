import { basename, resolve } from "node:path";
import type { Mutable } from "@plot/common/primitives";
import { createSessionId } from "./runtime.js";
import {
	assertWorkflowAgentReady,
	makeCreatePiAgentSession,
} from "./pi-session.js";
import { makePlotExtensionSourceBundleFromWorkflow } from "./extension-source.js";
import {
	resolveSessionPaths,
	sessionEventLogPath,
	type SessionPaths,
} from "./paths.js";
import { makePiWorkRunner, type CreatePiAgentSession } from "./pi-runner.js";
import { makeSessionRuntime } from "./runtime.js";
import type { SessionRuntime, SessionRuntimeOptions } from "./runtime.js";
import { loadDiscoveredWorkflow, type WorkflowDefinition } from "./workflow.js";

export interface SessionHostMetadata {
	readonly workflowName: string;
	readonly workflowPath: string;
	readonly cwd: string;
	readonly cwdName: string;
	readonly sessionDir: string;
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
	readonly requestQueueCapacity?: number;
	readonly eventCapacity?: number;
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly stallTimeoutMs?: number;
}

const positive = (value: number, name: string): number => {
	if (!Number.isInteger(value) || value < 1)
		throw new Error(`${name} must be a positive integer`);
	return value;
};

const optionalPositive = (
	value: number | undefined,
	name: string,
): number | undefined =>
	value === undefined ? undefined : positive(value, name);

export const createSessionHost = async (
	options: CreateSessionHostOptions,
): Promise<SessionHost> => {
	const paths = resolveSessionPaths(options);
	const workflow = await loadDiscoveredWorkflow({
		cwd: paths.cwd,
		workflowPath:
			options.workflowPath === undefined
				? undefined
				: resolve(paths.cwd, options.workflowPath),
	});
	const plot = workflow.runtime.plot;
	const requestQueueCapacity = positive(
		options.requestQueueCapacity ?? plot?.queueCapacity ?? 64,
		"requestQueueCapacity",
	);
	const eventCapacity = positive(
		options.eventCapacity ?? plot?.eventCapacity ?? 256,
		"eventCapacity",
	);
	const tickIntervalMs = optionalPositive(
		options.tickIntervalMs ?? plot?.tickIntervalMs,
		"tickIntervalMs",
	);
	const maxRunDurationMs = optionalPositive(
		options.maxRunDurationMs ?? plot?.maxRunDurationMs,
		"maxRunDurationMs",
	);
	const stallTimeoutMs = optionalPositive(
		options.stallTimeoutMs ?? plot?.stallTimeoutMs,
		"stallTimeoutMs",
	);
	const sessionId = options.sessionId ?? createSessionId();
	if (options.createAgentSession === undefined)
		assertWorkflowAgentReady(workflow, paths);
	const extensionBundle = await makePlotExtensionSourceBundleFromWorkflow({
		workflow,
		paths,
	});
	const createAgentSession =
		options.createAgentSession ?? makeCreatePiAgentSession({ workflow, paths });
	let runtime: SessionRuntime;
	const runner = makePiWorkRunner({
		createAgentSession,
		prompt: workflow.prompt,
		create: (context) => extensionBundle.createOptions(context),
		maxTurns: workflow.runtime.agent?.maxTurns ?? 20,
		onEvent: async ({ context, event }) => {
			await runtime.appendAgentEvent({
				sourceId: context.sourceId,
				runId: context.run.runId,
				workKey: context.work.workKey,
				event,
			});
		},
	});
	const metadata: SessionHostMetadata = {
		workflowName:
			workflow.runtime.name ??
			(workflow.path ? basename(workflow.path) : "workflow"),
		workflowPath: workflow.path ?? "WORKFLOW.md",
		cwd: paths.cwd,
		cwdName: basename(paths.cwd),
		sessionDir: paths.sessionDir,
	};
	const sessionFile = sessionEventLogPath(paths.sessionDir, sessionId);
	const runtimeOptions: Mutable<SessionRuntimeOptions> = {
		id: sessionId,
		sources: [extensionBundle.source],
		runner: extensionBundle.wrapRunner(runner),
		state: metadata,
		sessionFile,
		eventCapacity,
		agent: {
			queueCapacity: requestQueueCapacity,
			tickIntervalMs,
			maxRunDurationMs,
			stallTimeoutMs,
		} as NonNullable<Parameters<typeof makeSessionRuntime>[0]["agent"]>,
	};
	runtimeOptions.sourceAction = {
		sourceId: extensionBundle.source.id,
		runAction: extensionBundle.runAction,
	};
	runtime = makeSessionRuntime(runtimeOptions);
	let shutdownPromise: Promise<void> | undefined;
	const shutdown = (): Promise<void> => {
		shutdownPromise ??= (async () => {
			let failure: unknown;
			try {
				await runtime.shutdown();
			} catch (error) {
				failure = error;
			}
			try {
				await extensionBundle.shutdown();
			} catch (error) {
				failure ??= error;
			}
			if (failure !== undefined) throw failure;
		})();
		return shutdownPromise;
	};
	return {
		runtime,
		paths,
		workflow,
		metadata,
		shutdown,
	};
};
