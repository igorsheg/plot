import {
	positiveInt,
	setFact,
	sourceId,
	subjectKey,
	workKey,
	type Completion,
} from "@plot/agent/model";
import type { WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { makePiWorkRunner } from "./pi/runner.js";
import { makePlotExtensionSourceBundleFromWorkflow } from "./extension-source.js";
import type { CreateAgentSession } from "./pi/agent-session.js";
import {
	makePlotCreateAgentSession,
	type PlotAgentSessionCliOverrides,
} from "./pi/agent-session.js";
import { resolvePlotPaths, type PlotPaths } from "./plot-paths.js";
import {
	makePlotSessionLayer,
	plotSessionId,
	type PlotSessionShape,
} from "./session.js";
import { basename } from "node:path";
import { createEventLogStore, type EventLogStore } from "./event-log.js";
import { makePlotProtocolLayer } from "./protocol-session.js";
import {
	plotSessionRegistrationKey,
	removePlotSessionRegistration,
	resolvePlotSessionDiscoveryDir,
	writePlotSessionRegistration,
	type PlotSessionRegistration,
} from "./session-registration.js";
import {
	defaultPlotProtocolLimits,
	type PlotProtocolLimits,
	type EventLogEvent,
} from "@plot/session/protocol";
import { runPlotProtocolStdio, type StdioChunk } from "./protocol-stdio.js";
import {
	loadDiscoveredWorkflowFromNode,
	type WorkflowDefinition,
} from "./workflow.js";
import { isRecord } from "./util.js";

export interface PlotSessionHostOptions {
	readonly workflowPath?: string;
	readonly sessionId: string;
	readonly cwd: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
	readonly requestQueueCapacity?: number;
	readonly eventCapacity?: number;
	readonly eventBufferCapacity?: number;
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly stallTimeoutMs?: number;
	readonly agentSessionOverrides?: PlotAgentSessionCliOverrides;
	readonly createAgentSession?: CreateAgentSession;
}
export interface PlotSessionHostStdioOptions extends PlotSessionHostOptions {
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (line: string) => Promise<void> | void;
}
export interface PlotSessionHostRunOptions extends PlotSessionHostOptions {
	readonly onEvent?: (event: EventLogEvent) => Promise<void> | void;
}
export interface PlotSessionHostDaemonOptions extends PlotSessionHostOptions {
	readonly onEvent?: (event: EventLogEvent) => Promise<void> | void;
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
	readonly eventBufferCapacity: number;
	readonly eventLog: EventLogStore;
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
const workflowName = (workflow: WorkflowDefinition): string =>
	workflow.runtime.name ??
	(workflow.path === undefined ? "workflow" : basename(workflow.path));
const registerSessionEventLog = async (input: {
	readonly eventLog: EventLogStore;
	readonly paths: PlotPaths;
	readonly workflow: WorkflowDefinition;
}): Promise<{
	readonly eventLog: EventLogStore;
	readonly shutdown: () => void;
}> => {
	const discoveryDir = resolvePlotSessionDiscoveryDir({
		agentDir: input.paths.agentDir,
	});
	const key = plotSessionRegistrationKey({
		cwd: input.paths.cwd,
		sessionId: input.eventLog.sessionId,
	});
	const startedAt = new Date().toISOString();
	const base = (): Omit<
		PlotSessionRegistration,
		"eventLogOffset" | "heartbeatAt" | "lastSequence" | "lastEventType"
	> => ({
		version: 1,
		key,
		sessionId: input.eventLog.sessionId,
		workflowName: workflowName(input.workflow),
		workflowPath: input.workflow.path ?? "WORKFLOW.md",
		cwd: input.paths.cwd,
		cwdName: basename(input.paths.cwd),
		sessionDir: input.eventLog.sessionPath,
		eventLogPath: input.eventLog.eventLogPath,
		pid: process.pid,
		startedAt,
	});
	const frontier = await input.eventLog.frontier();
	let lastSequence = frontier.lastSequence;
	let eventLogOffset = frontier.byteOffset;
	let lastEventType: string | undefined;
	const write = async (heartbeatAt = new Date().toISOString()) => {
		try {
			await writePlotSessionRegistration({
				discoveryDir,
				registration: {
					...base(),
					heartbeatAt,
					lastSequence,
					eventLogOffset,
					...(lastEventType === undefined ? {} : { lastEventType }),
				},
			});
		} catch {
			// ponytail: discovery is display metadata; never break the agent session.
		}
	};
	await write(startedAt);
	const heartbeat = setInterval(() => {
		void write();
	}, 2_000);
	heartbeat.unref?.();
	return {
		eventLog: {
			...input.eventLog,
			append: async (event) => {
				const appended = await input.eventLog.append(event);
				const nextFrontier = await input.eventLog.frontier();
				lastSequence = nextFrontier.lastSequence;
				eventLogOffset = nextFrontier.byteOffset;
				lastEventType = appended.type;
				if (appended.kind !== "agent_session_event")
					await write(appended.timestamp);
				return appended;
			},
		},
		shutdown: () => {
			clearInterval(heartbeat);
			void removePlotSessionRegistration({ discoveryDir, key });
		},
	};
};
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
	readonly eventBufferCapacity: number;
}): PlotProtocolLimits => ({
	...defaultPlotProtocolLimits,
	maxPendingRequests: positiveInt(values.requestQueueCapacity),
	maxEventBufferEvents: positiveInt(values.eventBufferCapacity),
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
	const eventBufferCapacity =
		options.eventBufferCapacity ?? plot?.eventBufferCapacity ?? 1024;
	const tickIntervalMs = options.tickIntervalMs ?? plot?.tickIntervalMs;
	const maxRunDurationMs = options.maxRunDurationMs ?? plot?.maxRunDurationMs;
	const stallTimeoutMs = options.stallTimeoutMs ?? plot?.stallTimeoutMs;
	const agentOptions = {
		queueCapacity: requestQueueCapacity,
		eventCapacity,
		...(tickIntervalMs === undefined ? {} : { tickIntervalMs }),
		...(maxRunDurationMs === undefined ? {} : { maxRunDurationMs }),
		...(stallTimeoutMs === undefined ? {} : { stallTimeoutMs }),
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
	const registration = await registerSessionEventLog({
		eventLog: await createEventLogStore({
			sessionDir: paths.sessionDir,
			sessionId: options.sessionId,
		}),
		paths,
		workflow,
	});
	const eventLog = registration.eventLog;
	const extensionBundle = workflow.runtime.extension
		? await makePlotExtensionSourceBundleFromWorkflow({ workflow, paths })
		: undefined;
	const sources = extensionBundle
		? [extensionBundle.source]
		: [makeOneShotWorkflowSource(workflow)];
	const agentRunnerCreate = async (context: WorkRunnerContext) => {
		const extensionCreate = await extensionBundle?.createOptions(context);
		return {
			cwd: paths.cwd,
			...(extensionCreate === undefined ||
			extensionCreate.customTools.length === 0
				? {}
				: { customTools: extensionCreate.customTools }),
		};
	};
	const session = makePlotSessionLayer({
		id: plotSessionId(options.sessionId),
		workflow,
		sources,
		eventCapacity,
		eventLog,
		agent: agentOptions,
		runner: (emitAgentEvent) => {
			const runner = makePiWorkRunner({
				createAgentSession,
				prompt: workflow.prompt,
				create: agentRunnerCreate,
				maxTurns: workflow.runtime.agent?.maxTurns ?? 20,
				onEvent: ({ context, event }) => emitAgentEvent(context, event),
			});
			return extensionBundle?.wrapRunner(runner) ?? runner;
		},
	});
	return {
		workflow,
		paths,
		requestQueueCapacity,
		eventBufferCapacity,
		eventLog,
		session,
		shutdown: async () => {
			registration.shutdown();
			await extensionBundle?.shutdown?.();
		},
	};
};
const completionFromEvent = (event: EventLogEvent): Completion | undefined =>
	event.kind !== "agent_session_event" &&
	event.type === "attempt_completed" &&
	isRecord(event.payload) &&
	isRecord(event.payload["completion"])
		? (event.payload["completion"] as unknown as Completion)
		: undefined;
const quiescentTickFromEvent = (event: EventLogEvent): boolean => {
	if (
		event.kind === "agent_session_event" ||
		event.type !== "tick_completed" ||
		!isRecord(event.payload)
	)
		return false;
	const result = event.payload["result"];
	if (!isRecord(result) || typeof result["runningCount"] !== "number")
		return false;
	return (
		result["runningCount"] === 0 &&
		result["startedCount"] === 0 &&
		result["selectedCount"] === 0
	);
};
export const createPlotProtocolSessionHost = async (
	options: PlotSessionHostOptions,
): Promise<PlotProtocolSessionHost> => {
	const host = await createPlotSessionHost(options);
	const limits = makePlotProtocolLimits({
		requestQueueCapacity: host.requestQueueCapacity,
		eventBufferCapacity: host.eventBufferCapacity,
	});
	return {
		...host,
		limits,
		protocol: makePlotProtocolLayer({
			limits,
			outputCapacity: host.requestQueueCapacity,
			session: host.session,
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
