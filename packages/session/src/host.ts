import { basename, resolve } from "node:path";
import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { setFact } from "@plot/agent/model";
import type { WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { createSessionId } from "./runtime.js";
import {
	makeCreatePiAgentSession,
	type AgentSessionOverrides,
} from "./agent-session.js";
import {
	makePlotExtensionSourceBundleFromWorkflow,
	type PlotExtensionSourceBundle,
} from "./extensions/source.js";
import { resolveSessionPaths, type SessionPaths } from "./paths.js";
import { makePiWorkRunner, type CreatePiAgentSession } from "./pi-runner.js";
import { defaultProtocolLimits, type ProtocolLimits } from "./protocol.js";
import { makeSessionProtocol, type SessionProtocol } from "./protocol.js";
import { makeSessionRuntime, type SessionRuntimeOptions } from "./runtime.js";
import type { SessionRuntime } from "./runtime.js";
import { loadDiscoveredWorkflow, type WorkflowDefinition } from "./workflow.js";
import type { WorkflowRuntimeConfig } from "./workflow.js";

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

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type AgentConfig = NonNullable<WorkflowRuntimeConfig["agent"]>;

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
	if (Number.isInteger(value) && value >= 1) return value;
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
	for (const part of parts.toReversed()) {
		// eslint-disable-next-line no-await-in-loop -- shutdown order is reverse construction order.
		await part.shutdown?.();
	}
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

const noToolsForPi = (
	value: AgentConfig["noTools"],
): CreateAgentSessionOptions["noTools"] => {
	if (value === undefined || value === false) return undefined;
	if (value === true) return "all";
	return value;
};

const baseCreateOptions = (input: {
	readonly paths: SessionPaths;
	readonly workflow: WorkflowDefinition;
}): CreateAgentSessionOptions => {
	const agent = input.workflow.runtime.agent;
	const noTools = noToolsForPi(agent?.noTools);
	const options: CreateAgentSessionOptions = {
		cwd: input.paths.cwd,
		agentDir: input.paths.agentDir,
	};
	if (agent?.thinking !== undefined) options.thinkingLevel = agent.thinking;
	if (agent?.tools !== undefined) options.tools = [...agent.tools];
	if (agent?.excludeTools !== undefined)
		options.excludeTools = [...agent.excludeTools];
	if (noTools !== undefined) options.noTools = noTools;
	return options;
};

const runnerCreateOptions = async (input: {
	readonly base: CreateAgentSessionOptions;
	readonly extensionBundle?: PlotExtensionSourceBundle;
	readonly context: WorkRunnerContext;
}): Promise<CreateAgentSessionOptions> => {
	const extensionCreate = await input.extensionBundle?.createOptions(
		input.context,
	);
	if (extensionCreate === undefined) return input.base;
	return {
		...input.base,
		...(extensionCreate.cwd === undefined ? {} : { cwd: extensionCreate.cwd }),
		...(extensionCreate.customTools.length === 0
			? {}
			: { customTools: extensionCreate.customTools }),
	};
};

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
	const workflow = await loadDiscoveredWorkflow({
		cwd: paths.cwd,
		...(options.workflowPath === undefined
			? {}
			: { workflowPath: resolve(paths.cwd, options.workflowPath) }),
	});
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
	const base = baseCreateOptions({ paths, workflow });
	const createAgentSession =
		options.createAgentSession ??
		makeCreatePiAgentSession({
			workflow,
			paths,
			...(options.agentSessionOverrides === undefined
				? {}
				: { overrides: options.agentSessionOverrides }),
		});
	let runtime: SessionRuntime;
	const runner = makePiWorkRunner({
		createAgentSession,
		prompt: workflow.prompt,
		create: (context) =>
			runnerCreateOptions({
				base,
				context,
				...(extensionBundle === undefined ? {} : { extensionBundle }),
			}),
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
	const agentOptions: Mutable<NonNullable<SessionRuntimeOptions["agent"]>> = {
		queueCapacity: requestQueueCapacity,
	};
	if (tickIntervalMs !== undefined)
		agentOptions.tickIntervalMs = tickIntervalMs;
	if (maxRunDurationMs !== undefined)
		agentOptions.maxRunDurationMs = maxRunDurationMs;
	if (stallTimeoutMs !== undefined)
		agentOptions.stallTimeoutMs = stallTimeoutMs;
	const metadata = makeMetadata({ workflow, paths });
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
		eventCapacity,
		agent: agentOptions,
	};
	runtime = makeSessionRuntime(runtimeOptions);
	const parts: SessionHostPart[] = [];
	if (extensionBundle !== undefined)
		parts.push({ shutdown: () => extensionBundle.shutdown() });
	parts.push({
		shutdown: async () => {
			await runtime.shutdown();
		},
	});
	return {
		runtime,
		paths,
		workflow,
		metadata,
		shutdown: () => shutdownHostParts(parts),
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
	const protocol = makeSessionProtocol({ runtime: host.runtime, limits });
	return {
		...host,
		limits,
		protocol,
		shutdown: async () => {
			await host.shutdown();
			await protocol.close();
		},
	};
};
