import { basename, resolve } from "node:path";
import { setFact } from "@plot/agent/model";
import type { WorkSource } from "@plot/agent/work-source";
import { isPositiveInteger, type Mutable } from "@plot/common/primitives";
import { createSessionId } from "./runtime.js";
import {
	makeCreatePiAgentSession,
	type AgentSessionOverrides,
} from "./pi-session.js";
import { makePlotExtensionSourceBundleFromWorkflow } from "./extension-source.js";
import {
	resolveSessionPaths,
	sessionEventLogPath,
	type SessionPaths,
} from "./paths.js";
import { makePiWorkRunner, type CreatePiAgentSession } from "./pi-runner.js";
import { defaultProtocolLimits, type ProtocolLimits } from "./protocol.js";
import { makeSessionProtocol, type SessionProtocol } from "./protocol.js";
import { makeSessionRuntime, type SessionRuntimeOptions } from "./runtime.js";
import type { SessionRuntime } from "./runtime.js";
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

export interface ProtocolSessionHost extends SessionHost {
	readonly protocol: SessionProtocol;
	readonly limits: ProtocolLimits;
}

export interface SessionHostPart {
	readonly shutdown?: () => Promise<void> | void;
}

export interface CreateSessionHostOptions {
	readonly cwd: string;
	readonly workflowPath?: string;
	readonly sessionId?: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
	readonly createAgentSession?: CreatePiAgentSession;
	readonly agentSessionOverrides?: AgentSessionOverrides;
	readonly requestQueueCapacity?: number;
	readonly eventCapacity?: number;
	readonly eventBufferCapacity?: number;
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly stallTimeoutMs?: number;
}

export class SessionHostError extends Error {
	override readonly name = "SessionHostError";
	readonly phase: "config";

	constructor(message: string) {
		super(message);
		this.phase = "config";
	}
}

const workflowSourceId = "workflow";
const workflowSubject = "workflow";
const workflowWorkKey = "workflow:default";
const workflowCompletedFact = "workflow:default:completed";

const positiveInteger = (value: number, field: string): number => {
	if (isPositiveInteger(value)) return value;
	throw new SessionHostError(`${field} must be a positive integer`);
};

const workflowName = (workflow: WorkflowDefinition): string =>
	workflow.runtime.name ??
	(workflow.path === undefined ? "workflow" : basename(workflow.path));

const makeOneShotWorkflowSource = (
	workflow: WorkflowDefinition,
): WorkSource => ({
	id: workflowSourceId,
	reconcile: ({ snapshot }) =>
		snapshot.completions.some(
			(completion) => completion.workKey === workflowWorkKey,
		)
			? [setFact(workflowCompletedFact, true)]
			: [],
	selectWork: ({ snapshot }) => {
		if (snapshot.running.has(workflowWorkKey)) return [];
		if (snapshot.facts.get(workflowCompletedFact) === true) return [];
		return [
			{
				workKey: workflowWorkKey,
				subject: workflowSubject,
				templateContext: { workflow: workflow.config },
			},
		];
	},
});

const shutdownHostParts = async (
	parts: readonly SessionHostPart[],
): Promise<void> => {
	let failure: unknown;
	for (const part of parts.toReversed()) {
		try {
			// eslint-disable-next-line no-await-in-loop -- shutdown order is reverse construction order.
			await part.shutdown?.();
		} catch (error) {
			failure ??= error;
		}
	}
	if (failure !== undefined) throw failure;
};

const makeProtocolLimits = (input: {
	readonly requestQueueCapacity: number;
	readonly eventBufferCapacity: number;
}): ProtocolLimits => ({
	...defaultProtocolLimits,
	maxPendingRequests: positiveInteger(
		input.requestQueueCapacity,
		"requestQueueCapacity",
	),
	maxBufferedEvents: positiveInteger(
		input.eventBufferCapacity,
		"eventBufferCapacity",
	),
});

const makeMetadata = (input: {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
}): SessionHostMetadata => ({
	workflowName: workflowName(input.workflow),
	workflowPath: input.workflow.path ?? "WORKFLOW.md",
	cwd: input.paths.cwd,
	cwdName: basename(input.paths.cwd),
	sessionDir: input.paths.sessionDir,
});

export const createSessionHost = async (
	options: CreateSessionHostOptions,
): Promise<SessionHost> => {
	const paths = resolveSessionPaths(options);
	const discoveryOptions: Mutable<
		Parameters<typeof loadDiscoveredWorkflow>[0]
	> = { cwd: paths.cwd };
	if (options.workflowPath !== undefined)
		discoveryOptions.workflowPath = resolve(paths.cwd, options.workflowPath);
	const workflow = await loadDiscoveredWorkflow(discoveryOptions);
	const plot = workflow.runtime.plot;
	const requestQueueCapacity = positiveInteger(
		options.requestQueueCapacity ?? plot?.queueCapacity ?? 64,
		"requestQueueCapacity",
	);
	const eventCapacity = positiveInteger(
		options.eventCapacity ?? plot?.eventCapacity ?? 256,
		"eventCapacity",
	);
	const tickIntervalMs = options.tickIntervalMs ?? plot?.tickIntervalMs;
	const maxRunDurationMs = options.maxRunDurationMs ?? plot?.maxRunDurationMs;
	const stallTimeoutMs = options.stallTimeoutMs ?? plot?.stallTimeoutMs;
	const sessionId = options.sessionId ?? createSessionId();
	const extensionBundle = workflow.runtime.extension
		? await makePlotExtensionSourceBundleFromWorkflow({ workflow, paths })
		: undefined;
	const sources = extensionBundle
		? [extensionBundle.source]
		: [makeOneShotWorkflowSource(workflow)];
	const factoryOptions: Mutable<
		Parameters<typeof makeCreatePiAgentSession>[0]
	> = { workflow, paths };
	if (options.agentSessionOverrides !== undefined)
		factoryOptions.overrides = options.agentSessionOverrides;
	const createAgentSession =
		options.createAgentSession ?? makeCreatePiAgentSession(factoryOptions);
	let runtime: SessionRuntime;
	const runner = makePiWorkRunner({
		createAgentSession,
		prompt: workflow.prompt,
		create: (context) => extensionBundle?.createOptions(context),
		maxTurns: workflow.runtime.agent?.maxTurns ?? 20,
		onEvent: async ({ context, event }) => {
			await runtime.appendAgentEvent({
				sourceId: String(context.sourceId),
				runId: String(context.run.runId),
				workKey: String(context.work.workKey),
				event,
			});
		},
	});
	const agentOptions: NonNullable<SessionRuntimeOptions["agent"]> = {
		queueCapacity: requestQueueCapacity,
	};
	if (tickIntervalMs !== undefined)
		agentOptions.tickIntervalMs = tickIntervalMs;
	if (maxRunDurationMs !== undefined)
		agentOptions.maxRunDurationMs = maxRunDurationMs;
	if (stallTimeoutMs !== undefined)
		agentOptions.stallTimeoutMs = stallTimeoutMs;
	const metadata = makeMetadata({ workflow, paths });
	const sessionFile = sessionEventLogPath(paths.sessionDir, sessionId);
	const runtimeOptions: SessionRuntimeOptions = {
		id: sessionId,
		sources,
		runner: extensionBundle?.wrapRunner(runner) ?? runner,
		state: {
			workflowName: metadata.workflowName,
			workflowPath: metadata.workflowPath,
			cwd: metadata.cwd,
			cwdName: metadata.cwdName,
			sessionDir: metadata.sessionDir,
		},
		sessionFile,
		eventCapacity,
		agent: agentOptions,
	};
	try {
		runtime = makeSessionRuntime(runtimeOptions);
	} catch (error) {
		await extensionBundle?.shutdown();
		throw error;
	}
	const parts: SessionHostPart[] = [];
	if (extensionBundle !== undefined)
		parts.push({ shutdown: () => extensionBundle.shutdown() });
	parts.push({
		shutdown: async () => {
			await runtime.shutdown();
		},
	});
	let shutdownPromise: Promise<void> | undefined;
	const shutdown = (): Promise<void> => {
		shutdownPromise ??= shutdownHostParts(parts);
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

export const createProtocolSessionHost = async (
	options: CreateSessionHostOptions,
): Promise<ProtocolSessionHost> => {
	const host = await createSessionHost(options);
	const limits = makeProtocolLimits({
		requestQueueCapacity:
			options.requestQueueCapacity ??
			host.workflow.runtime.plot?.queueCapacity ??
			64,
		eventBufferCapacity:
			options.eventBufferCapacity ??
			host.workflow.runtime.plot?.eventBufferCapacity ??
			1024,
	});
	const protocol = makeSessionProtocol({
		runtime: host.runtime,
		limits,
		shutdown: async () => {
			await host.shutdown();
			return true;
		},
	});
	return {
		...host,
		limits,
		protocol,
		shutdown: async () => {
			try {
				await host.shutdown();
			} finally {
				await protocol.close();
			}
		},
	};
};
