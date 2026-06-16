import {
	positiveInt,
	setFact,
	sourceId,
	subjectKey,
	workKey,
	type Completion,
	type TickResult,
} from "@plot/agent/model";
import type { WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { makeAgentSessionClientLayer } from "./agent-session-client.js";
import { makePlotExtensionSourceBundleFromWorkflow } from "./extension-source.js";
import type { CreateAgentSession } from "./agent-session-types.js";
import {
	makePlotCreateAgentSession,
	type PlotAgentSessionCliOverrides,
} from "./pi-agent-session.js";
import { makePlotAuth } from "./pi-auth.js";
import { resolvePlotPaths, type PlotPaths } from "./plot-paths.js";
import {
	makePlotSessionLayer,
	plotSessionId,
	type PlotSessionEvent,
	type PlotSessionShape,
} from "./plot-session.js";
import {
	createSessionHistoryStore,
	type SessionHistoryStore,
} from "./session-history.js";
import { makePlotProtocolLayer } from "./protocol-handler.js";
import {
	defaultPlotProtocolLimits,
	type PlotProtocolLimits,
} from "./protocol.js";
import { runPlotProtocolStdio, type StdioChunk } from "./protocol-stdio.js";
import {
	loadDiscoveredWorkflowFromNode,
	type WorkflowDefinition,
} from "./workflow.js";
import { makeWorkspaceManager, workspaceBaseDir } from "./workspace.js";

export interface PlotSessionHostOptions {
	readonly workflowPath?: string;
	readonly sessionId: string;
	readonly cwd: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
	readonly requestQueueCapacity?: number;
	readonly eventCapacity?: number;
	readonly replayCapacity?: number;
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly stallTimeoutMs?: number;
	readonly retryInitialDelayMs?: number;
	readonly retryMaxDelayMs?: number;
	readonly agentSessionOverrides?: PlotAgentSessionCliOverrides;
	readonly createAgentSession?: CreateAgentSession;
}
export interface PlotSessionHostStdioOptions extends PlotSessionHostOptions {
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (line: string) => Promise<void> | void;
}
export interface PlotSessionHostRunOptions extends PlotSessionHostOptions {
	readonly onEvent?: (event: PlotSessionEvent) => Promise<void> | void;
}
export interface PlotSessionHostDaemonOptions extends PlotSessionHostOptions {
	readonly onEvent?: (event: PlotSessionEvent) => Promise<void> | void;
}
export interface PlotSessionHostRunResult {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
	readonly completion: Completion;
}
export interface PlotSessionHost {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
	readonly requestQueueCapacity: number;
	readonly replayCapacity: number;
	readonly sessionHistory: SessionHistoryStore;
	readonly session: PlotSessionShape;
	readonly shutdown: () => Promise<void>;
}
export interface PlotProtocolSessionHost extends PlotSessionHost {
	readonly protocol: ReturnType<typeof makePlotProtocolLayer>;
	readonly limits: PlotProtocolLimits;
}
export class PlotSessionHostRunError extends Error {
	readonly phase = "run";
	constructor(input: { readonly phase?: "run"; readonly message: string }) {
		super(input.message);
		this.name = "PlotSessionHostRunError";
	}
}
const workflowSourceId = sourceId("workflow");
const workflowSubject = subjectKey("workflow");
const workflowWorkKey = workKey("workflow:default");
const workflowCompletedFact = "workflow:default:completed";
export const makeOneShotWorkflowSource = (
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
export const makePlotProtocolLimits = (values: {
	readonly requestQueueCapacity: number;
	readonly replayCapacity: number;
}): PlotProtocolLimits => ({
	...defaultPlotProtocolLimits,
	maxPendingRequests: positiveInt(values.requestQueueCapacity),
	maxEventBufferEvents: positiveInt(values.replayCapacity),
});
export const createPlotSessionHost = async (
	options: PlotSessionHostOptions,
): Promise<PlotSessionHost> => {
	const workflow = await loadDiscoveredWorkflowFromNode({
		cwd: options.cwd,
		...(options.workflowPath === undefined
			? {}
			: { workflowPath: options.workflowPath }),
	});
	const paths = resolvePlotPaths({
		cwd: options.cwd,
		...(options.plotDir === undefined ? {} : { plotDir: options.plotDir }),
		...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
		...(options.sessionDir === undefined
			? {}
			: { sessionDir: options.sessionDir }),
	});
	const plot = workflow.runtime.plot;
	const requestQueueCapacity =
		options.requestQueueCapacity ?? plot?.queueCapacity ?? 64;
	const eventCapacity = options.eventCapacity ?? plot?.eventCapacity ?? 256;
	const replayCapacity = options.replayCapacity ?? plot?.replayCapacity ?? 1024;
	const tickIntervalMs = options.tickIntervalMs ?? plot?.tickIntervalMs;
	const maxRunDurationMs = options.maxRunDurationMs ?? plot?.maxRunDurationMs;
	const stallTimeoutMs = options.stallTimeoutMs ?? plot?.stallTimeoutMs;
	const retryInitialDelayMs =
		options.retryInitialDelayMs ?? plot?.retryInitialDelayMs;
	const retryMaxDelayMs = options.retryMaxDelayMs ?? plot?.retryMaxDelayMs;
	const agentOptions = {
		queueCapacity: requestQueueCapacity,
		eventCapacity,
		...(tickIntervalMs === undefined ? {} : { tickIntervalMs }),
		...(maxRunDurationMs === undefined ? {} : { maxRunDurationMs }),
		...(stallTimeoutMs === undefined ? {} : { stallTimeoutMs }),
		...(retryInitialDelayMs === undefined ? {} : { retryInitialDelayMs }),
		...(retryMaxDelayMs === undefined ? {} : { retryMaxDelayMs }),
	};
	const createAgentSession =
		options.createAgentSession ??
		makePlotCreateAgentSession({
			workflow,
			paths,
			...(options.agentSessionOverrides === undefined
				? {}
				: { overrides: options.agentSessionOverrides }),
		});
	const client = makeAgentSessionClientLayer({ createAgentSession });
	const sessionHistory = await createSessionHistoryStore({
		sessionDir: paths.sessionDir,
		sessionId: options.sessionId,
	});
	// Workspace manager (opt-in via plot.workspace): the runtime guarantees a
	// safe, durable per-work directory and runs the agent session inside it;
	// populating the directory stays with the agent/workflow.
	const workspaceConfig = plot?.workspace;
	const workspaces =
		workspaceConfig === undefined
			? undefined
			: makeWorkspaceManager({
					root: workspaceConfig.root,
					baseDir: workspaceBaseDir(workflow.path, options.cwd),
					namespace: workflow.runtime.name ?? "workflow",
					...(workspaceConfig.cleanup === undefined
						? {}
						: { cleanup: workspaceConfig.cleanup }),
				});
	const workspaceKeyFor = (context: WorkRunnerContext) =>
		extensionBundle?.workFor(context)?.id ??
		String(context.run.subject ?? context.work.workKey);
	const extensionBundle = workflow.runtime.extension
		? await makePlotExtensionSourceBundleFromWorkflow({
				workflow,
				paths,
				...(workspaces === undefined || workspaces.cleanup !== "on_released"
					? {}
					: {
							onWorkReleased: async (workId: string) => {
								await workspaces.remove(workId);
							},
						}),
			})
		: undefined;
	const sources = extensionBundle
		? [extensionBundle.source]
		: [makeOneShotWorkflowSource(workflow)];
	const agentRunnerCreate = async (context: WorkRunnerContext) => {
		const extensionCreate = await extensionBundle?.createOptions(context);
		const workspace =
			workspaces === undefined
				? undefined
				: await workspaces.ensure(workspaceKeyFor(context));
		return {
			cwd: workspace?.path ?? paths.cwd,
			...(extensionCreate === undefined ||
			extensionCreate.customTools.length === 0
				? {}
				: { customTools: extensionCreate.customTools }),
		};
	};
	const workspaceTemplateData =
		workspaces === undefined
			? undefined
			: async (context: WorkRunnerContext) => ({
					workspace: await workspaces.ensure(workspaceKeyFor(context)),
				});
	const session = makePlotSessionLayer({
		id: plotSessionId(options.sessionId),
		workflow,
		sources,
		eventCapacity,
		sessionHistory,
		agent: agentOptions,
		agentRunner: {
			prompt: workflow.prompt,
			create: agentRunnerCreate,
			maxTurns: workflow.runtime.agent?.maxTurns ?? 20,
			...(workspaceTemplateData === undefined
				? {}
				: { templateData: workspaceTemplateData }),
			...(extensionBundle === undefined
				? {}
				: { wrapRunner: extensionBundle.wrapRunner }),
		},
		client,
	});
	return {
		workflow,
		paths,
		requestQueueCapacity,
		replayCapacity,
		sessionHistory,
		session,
		shutdown: extensionBundle?.shutdown ?? (async () => {}),
	};
};
const completionFromEvent = (event: PlotSessionEvent): Completion | undefined =>
	event.type === "plot_agent_event" && event.event.type === "work_completed"
		? event.event.completion
		: undefined;
const quiescentTickFromEvent = (
	event: PlotSessionEvent,
): TickResult | undefined => {
	if (
		event.type !== "plot_agent_event" ||
		event.event.type !== "tick_completed"
	)
		return undefined;
	const result = event.event.result;
	if (
		result.snapshot.running.size > 0 ||
		result.started.length > 0 ||
		result.selected.length > 0
	)
		return undefined;
	return result;
};
export const createPlotProtocolSessionHost = async (
	options: PlotSessionHostOptions,
): Promise<PlotProtocolSessionHost> => {
	const host = await createPlotSessionHost(options);
	const limits = makePlotProtocolLimits({
		requestQueueCapacity: host.requestQueueCapacity,
		replayCapacity: host.replayCapacity,
	});
	return {
		...host,
		limits,
		protocol: makePlotProtocolLayer({
			limits,
			outputCapacity: host.requestQueueCapacity,
			auth: makePlotAuth(host.paths),
			session: host.session,
			sessionHistory: host.sessionHistory,
		}),
	};
};
export const runPlotSessionHostOnce = async (
	options: PlotSessionHostRunOptions,
): Promise<PlotSessionHostRunResult> => {
	const host = await createPlotSessionHost(options);
	const completed: Completion[] = [];
	let resolveQuiescent!: () => void;
	const quiescent = new Promise<void>((resolve) => {
		resolveQuiescent = resolve;
	});
	let listening = true;
	void (async () => {
		for await (const event of host.session.events()) {
			if (!listening) break;
			await options.onEvent?.(event);
			const completion = completionFromEvent(event);
			if (completion) completed.push(completion);
			if (quiescentTickFromEvent(event)) resolveQuiescent();
		}
	})();
	try {
		await host.session.start();
		await quiescent;
		await host.session.shutdown();
		const completion = completed.at(-1);
		if (!completion)
			throw new PlotSessionHostRunError({
				message: "plot run finished without completing work",
			});
		return { workflow: host.workflow, paths: host.paths, completion };
	} finally {
		listening = false;
		await host.shutdown();
	}
};
export const runPlotSessionHostDaemon = async (
	options: PlotSessionHostDaemonOptions,
): Promise<void> => {
	const host = await createPlotSessionHost(options);
	try {
		void (async () => {
			for await (const event of host.session.events())
				await options.onEvent?.(event);
		})();
		await host.session.start();
		await new Promise<void>(() => {});
	} finally {
		await host.session.shutdown();
		await host.shutdown();
	}
};
export const runPlotSessionHostStdio = async (
	options: PlotSessionHostStdioOptions,
): Promise<void> => {
	const host = await createPlotProtocolSessionHost(options);
	try {
		await runPlotProtocolStdio({
			stdin: options.stdin,
			writeStdout: options.writeStdout,
			limits: host.limits,
			protocol: host.protocol,
		});
	} finally {
		await host.shutdown();
	}
};
