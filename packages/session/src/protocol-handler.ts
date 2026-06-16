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
import type { PlotSessionSummary } from "@plot/control/session-summary";
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
	readonly listArchivedSessions?: () => Promise<readonly PlotSessionSummary[]>;
	readonly shutdownServer?: () => Promise<void> | void;
	readonly connectionId?: string;
}
export interface PlotProtocolShape {
	readonly welcome: () => Promise<PlotWelcomeRecord>;
	readonly submit: (request: PlotClientRecord) => Promise<boolean>;
	readonly output: () => AsyncIterable<PlotServerRecord>;
	readonly close: () => Promise<void>;
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

const mergeSessionSummaries = (
	live: readonly PlotSessionSummary[],
	archived: readonly PlotSessionSummary[],
): readonly PlotSessionSummary[] => {
	const liveIds = new Set(live.map((session) => session.id));
	return [...live, ...archived.filter((session) => !liveIds.has(session.id))];
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
	const ownedSessions = new Set<string>();
	const eventPumps = new Set<string>();
	let closed = false;
	let shutdownScheduled = false;
	const publishOutput = (record: PlotServerRecord) => output.publish(record);
	const scheduleServerShutdownIfIdle = () => {
		if (shutdownScheduled || registry.list().length !== 0) return;
		if (!options.shutdownServer) return;
		shutdownScheduled = true;
		const timer = setTimeout(() => {
			shutdownScheduled = false;
			if (registry.list().length === 0) void options.shutdownServer?.();
		}, 0);
		timer.unref?.();
	};
	const attachSession = async (
		runtime: ControlSessionRuntime,
		role: "observer" | "controller",
	): Promise<boolean> => {
		if (closed) return false;
		attachments.set(runtime.sessionId, role);
		await registry.attach({
			sessionId: runtime.sessionId,
			connectionId,
			role,
		});
		if (closed) {
			attachments.delete(runtime.sessionId);
			await registry.detach({
				sessionId: runtime.sessionId,
				connectionId,
			});
			return false;
		}
		startPump(runtime);
		return true;
	};
	const detachSession = async (sessionId: string) => {
		attachments.delete(sessionId);
		await registry.detach({ sessionId, connectionId });
	};
	const closeRuntime = async (runtime: ControlSessionRuntime) => {
		try {
			await runtime.close();
		} finally {
			ownedSessions.delete(runtime.sessionId);
			await registry.unregister(runtime.sessionId).catch(() => undefined);
		}
	};
	const closeOwnedSessions = async () => {
		await Promise.all(
			[...ownedSessions].map(async (sessionId) => {
				const runtime = registry.get(sessionId);
				if (runtime !== undefined)
					await closeRuntime(runtime).catch(() => undefined);
				else ownedSessions.delete(sessionId);
			}),
		);
		scheduleServerShutdownIfIdle();
	};

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
		const pumpKey = `${runtime.sessionId}:${runtime.epoch}`;
		if (eventPumps.has(pumpKey)) return;
		eventPumps.add(pumpKey);
		void (async () => {
			try {
				for await (const event of runtime.events()) {
					if (!attachments.has(runtime.sessionId)) continue;
					publishOutput(makePlotSessionEventRecord(event));
				}
			} finally {
				eventPumps.delete(pumpKey);
			}
		})();
	};

	const handleRequest = async (
		request: PlotClientRecord,
	): Promise<readonly PlotServerRecord[]> => {
		switch (request.command as PlotCommand) {
			case "ping":
				return [makeSuccessForRequest(request, { data: { pong: true } })];
			case "list_sessions": {
				const live = await registry.summaries();
				const archived = (await options.listArchivedSessions?.()) ?? [];
				return [
					makeSuccessForRequest(request, {
						data: { sessions: mergeSessionSummaries(live, archived) },
					}),
				];
			}
			case "open_session": {
				if (!options.openSession)
					throw new PlotProtocolFailure({
						code: "invalid_request",
						message: "open_session is not configured for this server",
					});
				const params = decodeOpenSessionParams(request.params);
				// Reuse a live session already registered under this id rather than
				// overwriting it with a second host. Two clients (e.g. TUI + web)
				// opening the same workflow must share one session; otherwise the old
				// host keeps pumping events while get_snapshot resolves to the new one,
				// and the dashboard oscillates between the two.
				const existing =
					params.sessionId === undefined
						? undefined
						: registry.get(params.sessionId);
				if (existing?.isClosing())
					throw new PlotProtocolFailure({
						code: "session_closed",
						message: `Plot Session ${existing.sessionId} is closing`,
					});
				if (existing !== undefined) {
					if (!(await attachSession(existing, params.role ?? "controller")))
						return [];
					if (
						params.lifetime === "connection" &&
						(params.role ?? "controller") === "controller"
					)
						ownedSessions.add(existing.sessionId);
					const lastSequence = await existing.frontier();
					return [
						makeSuccessForRequest(request, {
							lastSequence,
							data: {
								session: await registry.summary(existing.sessionId),
								lastSequence,
							},
						}),
					];
				}
				const runtime = await options.openSession(params);
				let registered = false;
				try {
					if (closed) {
						await runtime.session.shutdown().catch(() => undefined);
						return [];
					}
					await registry.register(runtime);
					registered = true;
					if (closed) {
						await runtime.close().catch(() => undefined);
						await registry.unregister(runtime.sessionId).catch(() => undefined);
						return [];
					}
					await runtime.session.start();
					if (closed) {
						await runtime.close().catch(() => undefined);
						await registry.unregister(runtime.sessionId).catch(() => undefined);
						return [];
					}
					if (!(await attachSession(runtime, params.role ?? "controller"))) {
						await runtime.close().catch(() => undefined);
						await registry.unregister(runtime.sessionId).catch(() => undefined);
						return [];
					}
					if (
						params.lifetime === "connection" &&
						(params.role ?? "controller") === "controller"
					)
						ownedSessions.add(runtime.sessionId);
				} catch (error) {
					await runtime.close().catch(() => undefined);
					if (registered)
						await registry.unregister(runtime.sessionId).catch(() => undefined);
					throw error;
				}
				const lastSequence = await runtime.frontier();
				return [
					makeSuccessForRequest(request, {
						lastSequence,
						data: {
							session: await registry.summary(runtime.sessionId),
							lastSequence,
						},
					}),
				];
			}
			case "attach_session": {
				const params = decodeAttachSessionParams(request.params);
				const runtime = getSession(registry, params.sessionId);
				if (runtime.isClosing())
					throw new PlotProtocolFailure({
						code: "session_closed",
						message: `Plot Session ${params.sessionId} is closing`,
					});
				if (!(await attachSession(runtime, params.role ?? "observer")))
					return [];
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
				await detachSession(params.sessionId);
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
				let accepted = false;
				try {
					accepted = await runtime.close();
				} finally {
					ownedSessions.delete(params.sessionId);
					await registry.unregister(params.sessionId).catch(() => undefined);
					scheduleServerShutdownIfIdle();
				}
				const lastSequence = await runtime.frontier();
				return [
					makeSuccessForRequest(request, { lastSequence, data: { accepted } }),
				];
			}
			case "shutdown_server": {
				if (!options.shutdownServer)
					throw new PlotProtocolFailure({
						code: "invalid_request",
						message: "shutdown_server is not configured for this server",
					});
				await Promise.all(
					registry.list().map(async (runtime) => {
						await runtime.close().catch(() => undefined);
						await registry.unregister(runtime.sessionId).catch(() => undefined);
					}),
				);
				const timer = setTimeout(() => {
					void options.shutdownServer?.();
				}, 0);
				timer.unref?.();
				return [makeSuccessForRequest(request, { data: { accepted: true } })];
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
			let queued: QueuedProtocolRequest;
			try {
				queued = await requests.take();
			} catch {
				break;
			}
			if (closed) {
				queued.resolve(false);
				break;
			}
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
				async () => {
					if (closed) return false;
					return new Promise<boolean>((resolve) => {
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
					});
				},
			),
		output: () => output.subscribe(),
		close: async () => {
			if (closed) return;
			closed = true;
			await closeOwnedSessions();
			attachments.clear();
			await registry.detachConnection(connectionId);
			requests.close();
		},
	};
};
