import { basename } from "node:path";
import { makeExtensionSource } from "./extension-source.js";
import { sessionEventLogPath, type SessionPaths } from "./paths.js";
import { createAgentRunner } from "./agent-runner.js";
import {
	makeSessionEventOwner,
	makeSessionRuntime,
	type SessionEventOwner,
	type SessionEventStore,
	type SessionRuntime,
} from "./runtime.js";
import type { PreparedWorkflow, WorkflowPlan } from "./workflow-plan.js";

export interface SessionHostMetadata extends Pick<
	SessionPaths,
	"cwd" | "sessionDir"
> {
	readonly workflowName: string;
	readonly workflowPath: string;
	readonly cwdName: string;
	readonly historyPath: string;
}

export interface SessionHost {
	readonly runtime: SessionRuntime;
	readonly events: SessionEventOwner;
	readonly paths: SessionPaths;
	readonly plan: WorkflowPlan;
	readonly metadata: SessionHostMetadata;
	readonly shutdown: () => Promise<void>;
}

export const createSessionHost = async (options: {
	readonly prepared: PreparedWorkflow;
	readonly sessionId?: string;
	readonly createEventStore: (sessionId: string) => SessionEventStore;
}): Promise<SessionHost> => {
	const { prepared } = options;
	const { plan, paths } = prepared;
	let extensionRuntime;
	try {
		extensionRuntime = await plan.extension.create({
			workflow: plan.definition,
			paths,
			config: plan.extensionConfig,
			credentials: prepared.credentials,
		});
	} catch (error) {
		await prepared.dispose();
		throw error;
	}
	const source = makeExtensionSource({
		extension: plan.extension,
		runtime: extensionRuntime,
		credentials: prepared.credentials,
		workflow: plan.definition,
		paths,
		config: plan.extensionConfig,
		maxConcurrentRuns: plan.maxConcurrentRuns,
	});
	const sessionId = options.sessionId ?? crypto.randomUUID();
	const historyPath = sessionEventLogPath(paths.sessionDir, sessionId);
	const events = makeSessionEventOwner({
		id: sessionId,
		store: options.createEventStore(sessionId),
	});
	const runner = createAgentRunner({
		createAgentSession: prepared.createAgentSession,
		prompt: plan.prompt,
		create: source.createOptions,
		maxTurns: plan.agent.maxTurns ?? 20,
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
		source,
		runner,
		tickIntervalMs: plan.plot?.tickIntervalMs,
		maxRunDurationMs: plan.plot?.maxRunDurationMs,
		stallTimeoutMs: plan.plot?.stallTimeoutMs,
	});
	const workflowPath =
		typeof prepared.identity === "string"
			? prepared.identity
			: "<programmatic>";
	let shutdownOperation: Promise<void> | undefined;
	const shutdown = () => {
		shutdownOperation ??= (async () => {
			try {
				await runtime.shutdown();
			} finally {
				await prepared.dispose();
			}
		})();
		return shutdownOperation;
	};
	return {
		runtime,
		events,
		paths,
		plan,
		metadata: {
			workflowName: plan.name,
			workflowPath,
			cwd: paths.cwd,
			cwdName: basename(paths.cwd),
			sessionDir: paths.sessionDir,
			historyPath,
		},
		shutdown,
	};
};
