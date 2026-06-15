import { AsyncQueue } from "@plot/common/async-queue";
import { EventHub } from "@plot/common/event-stream";
import { withWideEvent } from "@plot/common/observability";
import {
	safeParseAttachSessionParams,
	safeParseAuthLoginParams,
	safeParseAuthProviderParams,
	safeParseAuthStatusParams,
	safeParseCloseSessionParams,
	safeParseDetachSessionParams,
	safeParseGetSnapshotParams,
	safeParseInterruptAgentRunParams,
	safeParseOpenSessionParams,
	safeParsePauseSessionParams,
	safeParsePerformOperatorActionParams,
	safeParseRequestTickParams,
	safeParseResumeSessionParams,
} from "@plot/control/protocol";
import type {
	OperatorAction,
	OperatorObservation,
} from "@plot/control/operator";
import type { PlotSessionShape } from "./plot-session.js";
import type { PlotAuthShape } from "./pi-auth.js";
import {
	PlotRosterEventRecord,
	PlotWelcomeRecord,
	defaultPlotProtocolLimits,
	formatProtocolParseIssues,
	makePlotErrorResponse,
	makePlotSessionEventRecord,
	makePlotSuccessResponse,
	PlotProtocolFailure,
	plotProtocolRequestId,
	plotProtocolSequence,
	type AttachSessionParams,
	type AuthLoginParams,
	type AuthProviderParams,
	type AuthStatusParams,
	type CloseSessionParams,
	type DetachSessionParams,
	type GetSnapshotParams,
	type InterruptAgentRunParams,
	type OpenSessionParams,
	type PauseSessionParams,
	type PerformOperatorActionParams,
	type PlotClientRecord,
	type PlotCommand,
	type PlotProtocolLimits,
	type PlotServerRecord,
	type RequestTickParams,
	type ResumeSessionParams,
} from "./protocol.js";
import {
	makeControlSessionRegistry,
	makeControlSessionRuntime,
	type ControlSessionRegistry,
	type ControlSessionRuntime,
} from "./control-server.js";
import type { SessionHistoryStore } from "./session-history.js";

export interface PlotProtocolLayerOptions {
	readonly limits?: PlotProtocolLimits;
	readonly capabilities?: readonly string[];
	readonly outputCapacity?: number;
	readonly auth?: PlotAuthShape;
	readonly session?: PlotSessionShape;
	readonly sessionHistory?: SessionHistoryStore;
	readonly registry?: ControlSessionRegistry;
	readonly openSession?: (
		params: OpenSessionParams,
	) => Promise<ControlSessionRuntime>;
	readonly connectionId?: string;
}
export interface PlotProtocolShape {
	readonly welcome: () => Promise<PlotWelcomeRecord>;
	readonly submit: (request: PlotClientRecord) => Promise<boolean>;
	readonly output: () => AsyncIterable<PlotServerRecord>;
}
interface QueuedProtocolRequest {
	readonly request: PlotClientRecord;
	readonly resolve: (value: boolean) => void;
}
export type PlotProtocol = PlotProtocolShape;
export const PlotProtocol = Symbol("PlotProtocol");

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const invalidParams = (
	issues: Parameters<typeof formatProtocolParseIssues>[0],
) =>
	new PlotProtocolFailure({
		code: "invalid_request",
		message: formatProtocolParseIssues(issues),
	});

const decodeWith = <A>(
	parse: (value: unknown) =>
		| { readonly success: true; readonly data: A }
		| {
				readonly success: false;
				readonly error: {
					readonly issues: Parameters<typeof formatProtocolParseIssues>[0];
				};
		  },
	value: unknown,
): A => {
	const parsed = parse(value);
	if (!parsed.success) throw invalidParams(parsed.error.issues);
	return parsed.data;
};

const decodeAttachSessionParams = (value: unknown): AttachSessionParams =>
	decodeWith(safeParseAttachSessionParams, value);
const decodeDetachSessionParams = (value: unknown): DetachSessionParams =>
	decodeWith(safeParseDetachSessionParams, value);
const decodeCloseSessionParams = (value: unknown): CloseSessionParams =>
	decodeWith(safeParseCloseSessionParams, value);
const decodePauseSessionParams = (value: unknown): PauseSessionParams =>
	decodeWith(safeParsePauseSessionParams, value);
const decodeResumeSessionParams = (value: unknown): ResumeSessionParams =>
	decodeWith(safeParseResumeSessionParams, value);
const decodeRequestTickParams = (value: unknown): RequestTickParams =>
	decodeWith(safeParseRequestTickParams, value);
const decodeInterruptAgentRunParams = (
	value: unknown,
): InterruptAgentRunParams =>
	decodeWith(safeParseInterruptAgentRunParams, value);
const decodePerformOperatorActionParams = (
	value: unknown,
): PerformOperatorActionParams =>
	decodeWith(safeParsePerformOperatorActionParams, value);
const decodeGetSnapshotParams = (value: unknown): GetSnapshotParams =>
	decodeWith(safeParseGetSnapshotParams, value);
const decodeOpenSessionParams = (value: unknown): OpenSessionParams =>
	decodeWith(safeParseOpenSessionParams, value);
const decodeAuthProviderParams = (value: unknown): AuthProviderParams =>
	decodeWith(safeParseAuthProviderParams, value);
const decodeAuthStatusParams = (value: unknown): AuthStatusParams =>
	decodeWith(safeParseAuthStatusParams, value);
const decodeAuthLoginParams = (value: unknown): AuthLoginParams =>
	decodeWith(safeParseAuthLoginParams, value);

const getSession = (registry: ControlSessionRegistry, sessionId: string) => {
	const runtime = registry.get(sessionId);
	if (!runtime)
		throw new PlotProtocolFailure({
			code: "session_not_found",
			message: `unknown Plot Session: ${sessionId}`,
		});
	return runtime;
};

const mapUnknownError = (error: unknown) =>
	error instanceof PlotProtocolFailure
		? error
		: new PlotProtocolFailure({
				code: "internal_error",
				message: errorMessage(error),
			});

const makeFailureForRequest = (
	request: PlotClientRecord,
	error: PlotProtocolFailure,
	lastSequence?: number,
) =>
	makePlotErrorResponse({
		id: request.id,
		command: request.command,
		code: error.code,
		message: error.message,
		...(lastSequence === undefined
			? {}
			: { lastSequence: plotProtocolSequence(lastSequence) }),
		...(error.details === undefined ? {} : { details: error.details }),
	});

const requireController = (
	attachments: ReadonlyMap<string, "observer" | "controller">,
	sessionId: string,
) => {
	const role = attachments.get(sessionId);
	if (role === undefined)
		throw new PlotProtocolFailure({
			code: "session_not_attached",
			message: `client is not attached to Plot Session ${sessionId}`,
		});
	if (role !== "controller")
		throw new PlotProtocolFailure({
			code: "unauthorized",
			message: "controller role is required for this command",
		});
};

const waitForRuntimeFrontier = async (runtime: ControlSessionRuntime) => {
	const target = Number(await runtime.session.lastEventSequence());
	for (let i = 0; i < 100; i++) {
		const current = await runtime.frontier();
		if (current >= target) return current;
		await Promise.resolve();
	}
	return runtime.frontier();
};

const validateOperatorAction = (
	action: OperatorAction | undefined,
	params: PerformOperatorActionParams,
) => {
	if (!action)
		throw new PlotProtocolFailure({
			code: "invalid_operator_action",
			message: "operator action is not currently declared for this Work Item",
		});
	if (action.disabledReason)
		throw new PlotProtocolFailure({
			code: "invalid_operator_action",
			message: action.disabledReason,
		});
	if (action.requiresComment && (params.comment?.trim() ?? "") === "")
		throw new PlotProtocolFailure({
			code: "invalid_operator_action",
			message: "operator action requires a comment",
		});
};

const wireMap = (value: unknown): unknown =>
	value instanceof Map ? Object.fromEntries(value.entries()) : value;

const wireSnapshot = (snapshot: unknown): unknown => {
	if (typeof snapshot !== "object" || snapshot === null) return snapshot;
	const record = snapshot as Record<string, unknown>;
	return {
		...record,
		running: wireMap(record["running"]),
		retries: wireMap(record["retries"]),
		facts: wireMap(record["facts"]),
	};
};

const makeSuccessForRequest = (
	request: PlotClientRecord,
	input: {
		readonly lastSequence?: number;
		readonly asOfSequence?: number;
		readonly data?: unknown;
	},
) =>
	makePlotSuccessResponse({
		id: request.id,
		command: request.command,
		...(input.asOfSequence === undefined
			? {}
			: { asOfSequence: plotProtocolSequence(input.asOfSequence) }),
		...(input.lastSequence === undefined
			? {}
			: { lastSequence: plotProtocolSequence(input.lastSequence) }),
		...(input.data === undefined ? {} : { data: input.data }),
	});

export const makePlotProtocolLayer = (
	options: PlotProtocolLayerOptions = {},
): PlotProtocolShape => {
	const limits = options.limits ?? defaultPlotProtocolLimits;
	const capabilities = options.capabilities ?? [
		"stdio_jsonl",
		"session_history_replay",
	];
	const output = new EventHub<PlotServerRecord>(
		options.outputCapacity ?? limits.maxPendingRequests,
	);
	const requests = new AsyncQueue<QueuedProtocolRequest>({
		capacity: limits.maxPendingRequests,
	});
	const registry = options.registry ?? makeControlSessionRegistry();
	const connectionId = plotProtocolRequestId(
		options.connectionId ?? "connection-1",
	);
	const attachments = new Map<string, "observer" | "controller">();
	const eventPumps = new Set<string>();
	const publishOutput = (record: PlotServerRecord) => output.publish(record);

	if (options.session) {
		void registry.register(
			makeControlSessionRuntime({
				session: options.session,
				...(options.sessionHistory === undefined
					? {}
					: { history: options.sessionHistory }),
				onChanged: async () => registry.publishChanged(options.session!.id),
			}),
		);
	}

	void (async () => {
		for await (const event of registry.rosterEvents())
			publishOutput(
				new PlotRosterEventRecord({
					event: event.type,
					session: event.session,
				}),
			);
	})();

	const startPump = (runtime: ControlSessionRuntime) => {
		if (eventPumps.has(runtime.sessionId)) return;
		eventPumps.add(runtime.sessionId);
		void (async () => {
			for await (const event of runtime.events()) {
				if (!attachments.has(runtime.sessionId)) continue;
				publishOutput(makePlotSessionEventRecord(event));
			}
		})();
	};

	const handleRequest = async (
		request: PlotClientRecord,
	): Promise<readonly PlotServerRecord[]> => {
		switch (request.command as PlotCommand) {
			case "ping":
				return [makeSuccessForRequest(request, { data: { pong: true } })];
			case "list_sessions":
				return [
					makeSuccessForRequest(request, {
						data: {
							sessions: await Promise.all(
								registry.list().map((runtime) => runtime.summary()),
							),
						},
					}),
				];
			case "open_session": {
				if (!options.openSession)
					throw new PlotProtocolFailure({
						code: "invalid_request",
						message: "open_session is not configured for this server",
					});
				const params = decodeOpenSessionParams(request.params);
				const runtime = await options.openSession(params);
				await registry.register(runtime);
				await runtime.session.start();
				attachments.set(runtime.sessionId, params.role ?? "controller");
				startPump(runtime);
				const lastSequence = await runtime.frontier();
				return [
					makeSuccessForRequest(request, {
						lastSequence,
						data: { session: await runtime.summary(), lastSequence },
					}),
				];
			}
			case "attach_session": {
				const params = decodeAttachSessionParams(request.params);
				const runtime = getSession(registry, params.sessionId);
				attachments.set(params.sessionId, params.role ?? "observer");
				startPump(runtime);
				const snapshot = wireSnapshot(await runtime.snapshot());
				const lastSequence = await runtime.frontier();
				const response = makeSuccessForRequest(request, {
					lastSequence,
					asOfSequence: lastSequence,
					data: { snapshot, lastSequence },
				});
				const replayed = await runtime.replayAfter(
					params.afterSequence ?? lastSequence,
				);
				return [response, ...replayed.map(makePlotSessionEventRecord)];
			}
			case "detach_session": {
				const params = decodeDetachSessionParams(request.params);
				getSession(registry, params.sessionId);
				attachments.delete(params.sessionId);
				return [makeSuccessForRequest(request, { data: { detached: true } })];
			}
			case "get_snapshot": {
				const params = decodeGetSnapshotParams(request.params);
				const runtime = getSession(registry, params.sessionId);
				if (!attachments.has(params.sessionId))
					throw new PlotProtocolFailure({
						code: "session_not_attached",
						message: `client is not attached to Plot Session ${params.sessionId}`,
					});
				const asOfSequence = await runtime.frontier();
				return [
					makeSuccessForRequest(request, {
						asOfSequence,
						lastSequence: asOfSequence,
						data: {
							snapshot: wireSnapshot(await runtime.snapshot()),
							asOfSequence,
						},
					}),
				];
			}
			case "pause_session": {
				const params = decodePauseSessionParams(request.params);
				const runtime = getSession(registry, params.sessionId);
				requireController(attachments, params.sessionId);
				const event = await runtime.pause();
				return [
					makeSuccessForRequest(request, {
						lastSequence: Number(event.sequence),
						data: { paused: true },
					}),
				];
			}
			case "resume_session": {
				const params = decodeResumeSessionParams(request.params);
				const runtime = getSession(registry, params.sessionId);
				requireController(attachments, params.sessionId);
				const event = await runtime.resume();
				return [
					makeSuccessForRequest(request, {
						lastSequence: Number(event.sequence),
						data: { resumed: true },
					}),
				];
			}
			case "request_tick": {
				const params = decodeRequestTickParams(request.params);
				const runtime = getSession(registry, params.sessionId);
				requireController(attachments, params.sessionId);
				if (runtime.isPaused()) {
					await runtime.recordControlEvent("tick_rejected", {
						reason: "session_paused",
					});
					throw new PlotProtocolFailure({
						code: "session_paused",
						message: "cannot request tick while Plot Session is paused",
					});
				}
				const result = await runtime.requestTick();
				const lastSequence = await waitForRuntimeFrontier(runtime);
				return [
					makeSuccessForRequest(request, { lastSequence, data: { result } }),
				];
			}
			case "interrupt_agent_run": {
				const params = decodeInterruptAgentRunParams(request.params);
				const runtime = getSession(registry, params.sessionId);
				requireController(attachments, params.sessionId);
				const accepted = await runtime.interruptAgentRun({
					runId: params.runId,
					...(params.workKey === undefined ? {} : { workKey: params.workKey }),
				});
				if (!accepted)
					throw new PlotProtocolFailure({
						code: "run_not_found",
						message: "no matching active Agent Run was interrupted",
					});
				const lastSequence = await waitForRuntimeFrontier(runtime);
				return [
					makeSuccessForRequest(request, {
						lastSequence,
						data: { interrupted: true },
					}),
				];
			}
			case "perform_operator_action": {
				const params = decodePerformOperatorActionParams(request.params);
				const runtime = getSession(registry, params.sessionId);
				requireController(attachments, params.sessionId);
				const declaration = await runtime.currentOperatorAction(params);
				validateOperatorAction(declaration?.action, params);
				const timestamp = new Date().toISOString();
				const observation: OperatorObservation = {
					sessionId: params.sessionId,
					sourceId: declaration!.sourceId,
					workKey: params.workKey,
					actionId: params.actionId,
					actionLabel: declaration!.action.label,
					timestamp,
					...(params.comment === undefined ? {} : { comment: params.comment }),
					actor: { role: "controller" },
					clientId: connectionId,
					...(declaration!.workDisplay === undefined
						? {}
						: { workDisplay: declaration!.workDisplay }),
					...(declaration!.workVersion === undefined
						? {}
						: { workVersion: declaration!.workVersion }),
				};
				const event = await runtime.recordOperatorObservation(observation);
				return [
					makeSuccessForRequest(request, {
						lastSequence: Number(event.sequence),
						asOfSequence: Number(event.sequence),
						data: { observation },
					}),
				];
			}
			case "close_session": {
				const params = decodeCloseSessionParams(request.params);
				const runtime = getSession(registry, params.sessionId);
				requireController(attachments, params.sessionId);
				const accepted = await runtime.close();
				const lastSequence = await waitForRuntimeFrontier(runtime);
				await registry.publishChanged(params.sessionId);
				return [
					makeSuccessForRequest(request, { lastSequence, data: { accepted } }),
				];
			}
			case "auth_providers": {
				if (!options.auth)
					throw new PlotProtocolFailure({
						code: "auth_unavailable",
						message: "auth service is not configured",
					});
				return [
					makeSuccessForRequest(request, {
						data: { providers: await options.auth.providers() },
					}),
				];
			}
			case "auth_status": {
				if (!options.auth)
					throw new PlotProtocolFailure({
						code: "auth_unavailable",
						message: "auth service is not configured",
					});
				const params = decodeAuthStatusParams(request.params);
				return [
					makeSuccessForRequest(request, {
						data: { status: await options.auth.status(params.provider) },
					}),
				];
			}
			case "auth_login": {
				if (!options.auth)
					throw new PlotProtocolFailure({
						code: "auth_unavailable",
						message: "auth service is not configured",
					});
				const params = decodeAuthLoginParams(request.params);
				await options.auth.login({
					provider: params.provider,
					...(params.promptResponses === undefined
						? {}
						: { promptResponses: params.promptResponses }),
					...(params.selectResponse === undefined
						? {}
						: { selectResponse: params.selectResponse }),
					...(params.manualCode === undefined
						? {}
						: { manualCode: params.manualCode }),
				});
				return [
					makeSuccessForRequest(request, {
						data: { provider: params.provider, loggedIn: true },
					}),
				];
			}
			case "auth_logout": {
				if (!options.auth)
					throw new PlotProtocolFailure({
						code: "auth_unavailable",
						message: "auth service is not configured",
					});
				const params = decodeAuthProviderParams(request.params);
				await options.auth.logout(params.provider);
				return [
					makeSuccessForRequest(request, {
						data: { provider: params.provider, loggedOut: true },
					}),
				];
			}
		}
	};

	const processRequest = async (request: PlotClientRecord) => {
		const runtimeForRequest =
			typeof request.params === "object" &&
			request.params !== null &&
			"sessionId" in request.params
				? registry.get(
						String(
							(request.params as { readonly sessionId?: unknown }).sessionId,
						),
					)
				: undefined;
		const lastBefore = await runtimeForRequest?.frontier();
		const records = await handleRequest(request).catch((error) => [
			makeFailureForRequest(request, mapUnknownError(error), lastBefore),
		]);
		for (const record of records) publishOutput(record);
	};

	void (async () => {
		while (true) {
			const queued = await requests.take();
			await processRequest(queued.request);
			queued.resolve(true);
		}
	})();

	return {
		welcome: async () =>
			withWideEvent(
				"plot_protocol.welcome",
				{ connection_id: connectionId },
				async () =>
					new PlotWelcomeRecord({
						connectionId,
						capabilities: [...capabilities],
						limits,
					}),
			),
		submit: async (request) =>
			withWideEvent(
				"plot_protocol.submit",
				{ request_id: request.id, command: request.command },
				async () =>
					new Promise<boolean>((resolve) => {
						if (!requests.offer({ request, resolve })) {
							publishOutput(
								makePlotErrorResponse({
									id: request.id,
									command: request.command,
									code: "request_queue_full",
									message: "protocol request queue is full",
								}),
							);
							resolve(false);
						}
					}),
			),
		output: () => output.subscribe(),
	};
};
