import { AsyncQueue } from "@plot/common/async-queue";
import { EventHub } from "@plot/common/event-stream";
import {
	PlotProtocolFailure,
	defaultPlotProtocolLimits,
	makePlotErrorResponse,
	makePlotEventRecord,
	makePlotSuccessResponse,
	makePlotWelcomeRecord,
	plotProtocolRequestId,
	plotProtocolSequence,
	safeParseEmptyParams,
	safeParseGetSnapshotParams,
	safeParseGetStateParams,
	safeParseInterruptAgentRunParams,
	safeParseRequestTickParams,
	type PlotClientRecord,
	type PlotCommand,
	type PlotProtocolLimits,
	type PlotServerRecord,
	type PlotSessionMetadata,
	type PlotWelcomeRecord,
} from "@plot/session/protocol";
import type { PlotSessionShape } from "./session.js";
import { errorMessage } from "./util.js";

export interface PlotProtocolLayerOptions {
	readonly limits?: PlotProtocolLimits;
	readonly metadata?: PlotSessionMetadata;
	readonly outputCapacity?: number;
	readonly session: PlotSessionShape;
}
export interface PlotProtocolShape {
	readonly welcome: () => Promise<PlotWelcomeRecord>;
	readonly submit: (request: PlotClientRecord) => Promise<boolean>;
	readonly output: () => AsyncIterable<PlotServerRecord>;
	readonly close: () => Promise<void>;
}
export type PlotProtocol = PlotProtocolShape;
export const PlotProtocol = Symbol("PlotProtocol");

interface QueuedProtocolRequest {
	readonly request: PlotClientRecord;
	readonly resolve: (value: boolean) => void;
}

const decodeWith = <A>(
	parse: (value: unknown) =>
		| { readonly success: true; readonly data: A }
		| {
				readonly success: false;
				readonly error: {
					readonly issues: readonly {
						readonly path: readonly PropertyKey[];
						readonly message: string;
					}[];
				};
		  },
	value: unknown,
): A => {
	const parsed = parse(value);
	if (!parsed.success)
		throw new PlotProtocolFailure({
			code: "invalid_request",
			message: parsed.error.issues.map((i) => i.message).join("; "),
		});
	return parsed.data;
};

const wireMap = (value: unknown): unknown =>
	value instanceof Map ? Object.fromEntries(value.entries()) : value;
const wireSnapshot = (snapshot: unknown): unknown => {
	if (typeof snapshot !== "object" || snapshot === null) return snapshot;
	const record = snapshot as Record<string, unknown>;
	return {
		...record,
		work: wireMap(record["work"]),
		running: wireMap(record["running"]),
		facts: wireMap(record["facts"]),
	};
};
const mapUnknownError = (error: unknown) =>
	error instanceof PlotProtocolFailure
		? error
		: new PlotProtocolFailure({
				code: "internal_error",
				message: errorMessage(error),
			});

export const makePlotProtocolLayer = (
	options: PlotProtocolLayerOptions,
): PlotProtocolShape => {
	const limits = options.limits ?? defaultPlotProtocolLimits;
	const output = new EventHub<PlotServerRecord>(
		options.outputCapacity ?? limits.maxPendingRequests,
	);
	const requests = new AsyncQueue<QueuedProtocolRequest>({
		capacity: limits.maxPendingRequests,
	});
	let closed = false;

	void (async () => {
		for await (const event of options.session.events())
			output.publish(makePlotEventRecord(event));
	})();

	const ok = async (
		request: PlotClientRecord,
		data?: unknown,
	): Promise<readonly PlotServerRecord[]> => {
		const lastSequence = await options.session.lastEventSequence();
		return [
			makePlotSuccessResponse({
				id: request.id,
				command: request.command,
				lastSequence: plotProtocolSequence(lastSequence),
				...(data === undefined ? {} : { data }),
			}),
		];
	};
	const handleRequest = async (
		request: PlotClientRecord,
	): Promise<readonly PlotServerRecord[]> => {
		switch (request.command as PlotCommand) {
			case "ping":
				decodeWith(safeParseEmptyParams, request.params);
				return ok(request, { pong: true });
			case "start":
				decodeWith(safeParseEmptyParams, request.params);
				await options.session.start();
				return ok(request, { started: true });
			case "shutdown":
				decodeWith(safeParseEmptyParams, request.params);
				return ok(request, { accepted: await options.session.shutdown() });
			case "get_state":
				decodeWith(safeParseGetStateParams, request.params);
				return ok(request, {
					sessionId: options.session.id,
					...(options.metadata === undefined
						? {}
						: { metadata: options.metadata }),
				});
			case "pause_dispatch":
				decodeWith(safeParseEmptyParams, request.params);
				await options.session.pauseDispatch();
				return ok(request, { paused: true });
			case "resume_dispatch":
				decodeWith(safeParseEmptyParams, request.params);
				await options.session.resumeDispatch();
				return ok(request, { resumed: true });
			case "interrupt_agent_run": {
				const params = decodeWith(
					safeParseInterruptAgentRunParams,
					request.params,
				);
				return ok(request, {
					accepted: await options.session.interruptAgentRun({
						runId: params.runId,
						...(params.workKey === undefined
							? {}
							: { workKey: params.workKey }),
					}),
				});
			}
			case "get_snapshot": {
				decodeWith(safeParseGetSnapshotParams, request.params);
				const lastSequence = await options.session.lastEventSequence();
				return [
					makePlotSuccessResponse({
						id: request.id,
						command: request.command,
						lastSequence: plotProtocolSequence(lastSequence),
						data: {
							snapshot: wireSnapshot(await options.session.snapshot()),
							lastSequence,
						},
					}),
				];
			}
			case "request_tick": {
				decodeWith(safeParseRequestTickParams, request.params);
				const result = await options.session.tickOnce();
				return ok(request, { result });
			}
		}
	};

	void (async () => {
		while (true) {
			let queued: QueuedProtocolRequest;
			try {
				queued = await requests.take();
			} catch {
				return;
			}
			const records = await handleRequest(queued.request).catch((error) => {
				const failure = mapUnknownError(error);
				return [
					makePlotErrorResponse({
						id: queued.request.id,
						command: queued.request.command,
						code: failure.code,
						message: failure.message,
						...(failure.details === undefined
							? {}
							: { details: failure.details }),
					}),
				];
			});
			for (const record of records) output.publish(record);
			queued.resolve(
				records.some((record) => record.kind === "response" && record.ok),
			);
		}
	})();

	return {
		welcome: async () =>
			makePlotWelcomeRecord({
				sessionId: options.session.id,
				limits,
			}),
		submit: async (request) => {
			if (closed) return false;
			return new Promise((resolve) =>
				requests.offer({
					request: { ...request, id: plotProtocolRequestId(request.id) },
					resolve,
				}),
			);
		},
		output: () => output.subscribe(),
		close: async () => {
			closed = true;
			requests.close();
			output.close();
		},
	};
};
