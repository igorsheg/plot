import { randomUUID } from "node:crypto";
import { errorMessage } from "@plot/common/primitives";
import type {
	Completion,
	Diagnostic,
	OperatorObservation,
	AgentEvent,
	WakeRequest,
	SourceWorkRecord,
	TickResult,
	WorkItem,
	WorkRecord,
	WorkRun,
} from "./model.js";
import type { WorkflowConfig } from "@plot/sdk";
import type { WorkRunner } from "./work-runner.js";
import type { SourceActiveRun, WorkSource } from "./work-source.js";

const OPERATOR_OBSERVATION_CAPACITY = 64;
const WAKE_CAPACITY = 256;

interface ActiveRun {
	readonly run: WorkRun;
	readonly work: WorkItem;
	readonly controller: AbortController;
	state: "running" | "draining";
	lastActivityAt: number;
	durationTimer?: ReturnType<typeof setTimeout>;
	stallTimer?: ReturnType<typeof setTimeout>;
}

interface ActiveTick {
	readonly controller: AbortController;
	readonly promise: Promise<TickResult>;
}

type AgentLifecycle =
	| { readonly state: "new" }
	| {
			readonly state: "running";
			readonly controller: AbortController;
			loop: Promise<void>;
			tick?: ActiveTick;
	  }
	| { readonly state: "stopping"; readonly done: Promise<void> }
	| { readonly state: "stopped" };

export interface Agent {
	readonly start: () => Promise<void>;
	readonly tickOnce: () => Promise<TickResult>;
	readonly offerOperatorObservation: (
		observation: OperatorObservation,
	) => boolean;
	readonly wake: () => void;
	readonly shutdown: () => Promise<void>;
}

export interface AgentOptions extends WorkflowConfig {
	readonly source: WorkSource;
	readonly runner: WorkRunner;
	readonly event: (event: AgentEvent) => unknown | Promise<unknown>;
}

const positive = (
	value: number | undefined,
	fallback: number,
	name: string,
) => {
	const actual = value ?? fallback;
	if (!Number.isInteger(actual) || actual < 1)
		throw new Error(`${name} must be a positive integer`);
	return actual;
};

const identity = (run: WorkRun) => ({
	runId: run.runId,
	sourceId: run.sourceId,
	workKey: run.workKey,
	subject: run.subject,
});

const succeeded = (run: WorkRun, output: unknown): Completion =>
	output === undefined
		? { ...identity(run), status: "succeeded" }
		: { ...identity(run), status: "succeeded", output };

const failed = (run: WorkRun, error: unknown): Completion => ({
	...identity(run),
	status: "failed",
	error: errorMessage(error),
});

const interrupted = (run: WorkRun, reason: string): Completion => ({
	...identity(run),
	status: "interrupted",
	reason,
});

const timedOut = (run: WorkRun, reason: string): Completion => ({
	...identity(run),
	status: "timed_out",
	reason,
});

const diagnosticFor = (completion: Completion): Diagnostic | undefined => {
	if (completion.status === "succeeded") return;
	return {
		level: completion.status === "failed" ? "error" : "warning",
		phase: "act",
		sourceId: completion.sourceId,
		runId: completion.runId,
		workKey: completion.workKey,
		message:
			completion.status === "failed" ? completion.error : completion.reason,
	};
};

const noop = () => {};

const clearRunTimers = (record: ActiveRun) => {
	if (record.durationTimer !== undefined) clearTimeout(record.durationTimer);
	if (record.stallTimer !== undefined) clearTimeout(record.stallTimer);
};

const abortable = async <A>(
	signal: AbortSignal,
	effect: () => Promise<A> | A,
): Promise<A | undefined> => {
	if (signal.aborted) return;
	let remove = noop;
	const aborted = new Promise<undefined>((resolve) => {
		const onAbort = () => resolve(undefined);
		remove = () => signal.removeEventListener("abort", onAbort);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([Promise.resolve().then(effect), aborted]);
	} finally {
		remove();
	}
};

export const createAgent = (options: AgentOptions): Agent => {
	const source = options.source;
	const sourceId = source.initial.sourceId;
	const maxConcurrentRuns = positive(
		source.maxConcurrentRuns,
		1,
		"maxConcurrentRuns",
	);
	const tickIntervalMs = positive(
		options.tickIntervalMs,
		30_000,
		"tickIntervalMs",
	);
	const maxRunDurationMs =
		options.maxRunDurationMs === undefined
			? undefined
			: positive(options.maxRunDurationMs, 1, "maxRunDurationMs");
	const stallTimeoutMs =
		options.stallTimeoutMs === undefined
			? undefined
			: positive(options.stallTimeoutMs, 1, "stallTimeoutMs");

	let lifecycle: AgentLifecycle = { state: "new" };
	let tickId = 0;
	let nextRun = 0;
	let sourceRecord = source.initial;
	let sourceWork = new Map<string, SourceWorkRecord>();
	let emittedWork = new Map<string, WorkRecord>();
	let tickRequested = false;
	let wakeTick: (() => void) | undefined;
	const runPrefix = `run-${randomUUID()}`;
	const active = new Map<string, ActiveRun>();
	const pendingCompletions = new Map<string, Completion>();
	const pendingObservations: OperatorObservation[] = [];
	const pendingDiagnostics: Diagnostic[] = [];
	const wakeTimers = new Set<ReturnType<typeof setTimeout>>();
	const emit = (event: AgentEvent) => Promise.resolve(options.event(event));
	const requestTick = () => {
		if (lifecycle.state !== "running") return;
		tickRequested = true;
		wakeTick?.();
		wakeTick = undefined;
	};
	const waitForTick = (signal: AbortSignal): Promise<void> => {
		if (tickRequested || signal.aborted) return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				signal.removeEventListener("abort", done);
				if (wakeTick === done) wakeTick = undefined;
				resolve();
			};
			wakeTick = done;
			signal.addEventListener("abort", done, { once: true });
		});
	};
	const queueCompletion = (record: ActiveRun, completion: Completion) => {
		const current = active.get(record.run.workKey);
		if (current !== record || pendingCompletions.has(record.run.runId))
			return false;
		pendingCompletions.set(record.run.runId, completion);
		requestTick();
		return true;
	};
	const resetStallTimer = (record: ActiveRun) => {
		if (stallTimeoutMs === undefined) return;
		if (record.stallTimer !== undefined) clearTimeout(record.stallTimer);
		record.stallTimer = setTimeout(() => {
			if (
				Date.now() - record.lastActivityAt < stallTimeoutMs ||
				!queueCompletion(
					record,
					timedOut(
						record.run,
						`work run stalled; no activity for ${stallTimeoutMs}ms`,
					),
				)
			)
				return;
			record.controller.abort();
		}, stallTimeoutMs);
		record.stallTimer.unref?.();
	};
	const view = (): Map<string, WorkRecord> => {
		const work = new Map<string, WorkRecord>(sourceWork);
		for (const record of active.values()) {
			const current = sourceWork.get(record.run.workKey);
			const item = current ?? record.work;
			work.set(record.run.workKey, {
				workKey: record.run.workKey,
				sourceId: record.run.sourceId,
				status: record.state,
				runId: record.run.runId,
				subject: item.subject ?? record.run.subject,
				display: item.display ?? record.run.display,
				operatorActions: item.operatorActions,
			});
		}
		return work;
	};
	const finish = async (record: ActiveRun, completion: Completion) => {
		if (active.get(record.run.workKey) !== record) return false;
		active.delete(record.run.workKey);
		clearRunTimers(record);
		try {
			await source.finished({
				run: record.run,
				work: record.work,
				completion,
			});
		} catch (error) {
			pendingDiagnostics.push({
				level: "error",
				phase: "reconcile",
				sourceId,
				runId: record.run.runId,
				workKey: record.run.workKey,
				message: errorMessage(error),
			});
		}
		const diagnostic = diagnosticFor(completion);
		if (diagnostic !== undefined) pendingDiagnostics.push(diagnostic);
		await emit({ type: "attempt_completed", completion });
		return true;
	};
	const scheduleWake = async (wake: WakeRequest): Promise<void> => {
		if (wakeTimers.size >= WAKE_CAPACITY)
			throw new Error(`scheduled wake capacity ${WAKE_CAPACITY} exceeded`);
		const timer = setTimeout(() => {
			wakeTimers.delete(timer);
			requestTick();
		}, wake.delayMs);
		timer.unref?.();
		wakeTimers.add(timer);
		await emit({ type: "wake_scheduled", ...wake });
	};
	const execute = (record: ActiveRun, startedTick: number) => {
		void (async () => {
			try {
				await source.started({ run: record.run, work: record.work });
				const result = await options.runner.run({
					sourceId,
					tickId: startedTick,
					run: record.run,
					work: record.work,
					signal: record.controller.signal,
					reportActivity: () => {
						if (record.controller.signal.aborted) return;
						record.lastActivityAt = Date.now();
						resetStallTimer(record);
					},
					shouldContinue: (turnNumber) =>
						source.continueWork({
							run: record.run,
							work: record.work,
							turnNumber,
							signal: record.controller.signal,
						}),
				});
				if (record.controller.signal.aborted)
					queueCompletion(
						record,
						interrupted(record.run, "work run interrupted"),
					);
				else queueCompletion(record, succeeded(record.run, result.output));
			} catch (error) {
				queueCompletion(
					record,
					record.controller.signal.aborted
						? interrupted(record.run, "work run interrupted")
						: failed(record.run, error),
				);
			}
		})();
	};

	const runTick = async (signal: AbortSignal): Promise<TickResult> => {
		const currentTick = ++tickId;
		await emit({ type: "tick_started", tickId: currentTick });
		let completionCount = 0;
		for (const completion of pendingCompletions.values()) {
			const record = active.get(completion.workKey);
			if (record === undefined || record.run.runId !== completion.runId)
				continue;
			if (await finish(record, completion)) completionCount++;
		}
		pendingCompletions.clear();
		const operatorObservations = pendingObservations.splice(0);
		const tickDiagnostics = pendingDiagnostics.splice(0);
		let reconciled;
		try {
			reconciled = await abortable(signal, () =>
				source.reconcile({
					tickId: currentTick,
					signal,
					operatorObservations,
					activeRuns: [...active.values()].map(
						(record): SourceActiveRun => ({
							run: record.run,
							work: record.work,
						}),
					),
				}),
			);
		} catch (error) {
			tickDiagnostics.push({
				level: "error",
				phase: "reconcile",
				sourceId,
				message: errorMessage(error),
			});
		}
		let started = 0;
		let selected: readonly WorkItem[] = [];
		const interruptedThisTick = new Set<string>();
		if (reconciled !== undefined && !signal.aborted) {
			const nextWork = new Map<string, SourceWorkRecord>();
			for (const work of reconciled.work) {
				if (nextWork.has(work.workKey))
					throw new Error(`duplicate reconciled work: ${work.workKey}`);
				nextWork.set(work.workKey, work);
			}
			sourceRecord = reconciled.source;
			sourceWork = nextWork;
			for (const record of active.values())
				record.state = sourceWork.has(record.run.workKey)
					? "running"
					: "draining";
			for (const cancellation of reconciled.cancel) {
				const record = active.get(cancellation.workKey);
				if (record === undefined) continue;
				interruptedThisTick.add(cancellation.workKey);
				record.controller.abort();
				const completion = interrupted(record.run, cancellation.reason);
				if (await finish(record, completion)) completionCount++;
			}
			await emit({ type: "source_observed", source: sourceRecord });
			const currentView = view();
			for (const work of currentView.values())
				await emit({ type: "work_observed", work });
			for (const key of emittedWork.keys())
				if (!currentView.has(key))
					await emit({ type: "work_removed", workKey: key });
			emittedWork = currentView;
			for (const wake of reconciled.wakes) await scheduleWake(wake);
			selected = reconciled.dispatch;
			const seen = new Set<string>();
			for (const work of selected.toSorted((a, b) =>
				a.workKey.localeCompare(b.workKey),
			)) {
				if (seen.has(work.workKey)) continue;
				seen.add(work.workKey);
				if (
					interruptedThisTick.has(work.workKey) ||
					active.has(work.workKey) ||
					active.size >= maxConcurrentRuns
				)
					continue;
				const run: WorkRun = {
					runId: `${runPrefix}-${nextRun++}`,
					sourceId,
					workKey: work.workKey,
					subject: work.subject,
					display: work.display,
				};
				const record: ActiveRun = {
					run,
					work,
					controller: new AbortController(),
					state: "running",
					lastActivityAt: Date.now(),
				};
				active.set(work.workKey, record);
				if (maxRunDurationMs !== undefined) {
					record.durationTimer = setTimeout(() => {
						if (
							queueCompletion(
								record,
								timedOut(record.run, "work run timed out"),
							)
						)
							record.controller.abort();
					}, maxRunDurationMs);
					record.durationTimer.unref?.();
				}
				resetStallTimer(record);
				started++;
				await emit({ type: "attempt_started", run });
				execute(record, currentTick);
			}
		}
		tickDiagnostics.push(...pendingDiagnostics.splice(0));
		const result: TickResult = {
			tickId: currentTick,
			selected: selected.length,
			started,
			completions: completionCount,
			diagnostics: tickDiagnostics,
			running: active.size,
		};
		if (!signal.aborted) await emit({ type: "tick_completed", result });
		return result;
	};

	const tickOnce = async (): Promise<TickResult> => {
		if (lifecycle.state === "new") await api.start();
		if (lifecycle.state !== "running")
			throw new Error(`cannot tick Agent while ${lifecycle.state}`);
		const running = lifecycle;
		if (running.tick !== undefined) return running.tick.promise;
		const controller = new AbortController();
		const onStop = () => controller.abort();
		running.controller.signal.addEventListener("abort", onStop, { once: true });
		const promise = runTick(controller.signal).finally(() => {
			running.controller.signal.removeEventListener("abort", onStop);
			if (running.tick?.promise === promise) delete running.tick;
		});
		running.tick = { controller, promise };
		return promise;
	};
	const runLoop = async (
		running: Extract<AgentLifecycle, { state: "running" }>,
	) => {
		for (;;) {
			if (lifecycle !== running || running.controller.signal.aborted) break;
			await waitForTick(running.controller.signal);
			if (lifecycle !== running || running.controller.signal.aborted) break;
			tickRequested = false;
			try {
				await tickOnce();
			} catch (error) {
				pendingDiagnostics.push({
					level: "error",
					phase: "act",
					message: errorMessage(error),
				});
			}
		}
	};

	const api: Agent = {
		start: async () => {
			if (lifecycle.state === "running") return;
			if (lifecycle.state !== "new")
				throw new Error(`cannot start Agent while ${lifecycle.state}`);
			const running: Extract<AgentLifecycle, { state: "running" }> = {
				state: "running",
				controller: new AbortController(),
				loop: Promise.resolve(),
			};
			lifecycle = running;
			running.loop = runLoop(running);
			const interval = setInterval(requestTick, tickIntervalMs);
			interval.unref?.();
			wakeTimers.add(interval);
			requestTick();
		},
		tickOnce,
		offerOperatorObservation: (observation) => {
			if (lifecycle.state !== "running") return false;
			if (pendingObservations.length >= OPERATOR_OBSERVATION_CAPACITY)
				return false;
			pendingObservations.push(observation);
			requestTick();
			return true;
		},
		wake: requestTick,
		shutdown: async () => {
			if (lifecycle.state === "stopped") return;
			if (lifecycle.state === "stopping") return lifecycle.done;
			if (lifecycle.state === "new") {
				lifecycle = { state: "stopped" };
				return;
			}
			const running = lifecycle;
			const done = (async () => {
				running.controller.abort();
				running.tick?.controller.abort();
				wakeTick?.();
				for (const timer of wakeTimers) clearTimeout(timer);
				wakeTimers.clear();
				await running.loop.catch(() => undefined);
				for (const record of active.values()) {
					record.controller.abort();
					await finish(
						record,
						interrupted(record.run, "work run interrupted by agent shutdown"),
					);
				}
				lifecycle = { state: "stopped" };
			})();
			lifecycle = { state: "stopping", done };
			await done;
		},
	};
	return api;
};
