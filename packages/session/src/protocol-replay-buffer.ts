import { Deferred, Effect, Ref } from "effect";
import {
	PlotProtocolFailure,
	defaultPlotProtocolLimits,
	plotProtocolSequence,
	type PlotEventRecord,
	type PlotProtocolLimits,
	type PlotProtocolSequence,
} from "./protocol.js";

interface ReplayEntry {
	readonly record: PlotEventRecord;
	readonly bytes: number;
}

interface ReplayWaiter {
	readonly sequence: number;
	readonly deferred: Deferred.Deferred<void>;
}

interface ReplayState {
	readonly entries: readonly ReplayEntry[];
	readonly bytes: number;
	readonly lastSequence: number;
	readonly waiters: readonly ReplayWaiter[];
}

export interface PlotProtocolReplaySnapshot {
	readonly firstEventSeq: PlotProtocolSequence;
	readonly lastEventSeq: PlotProtocolSequence;
}

export interface PlotProtocolReplayBuffer {
	readonly append: (record: PlotEventRecord) => Effect.Effect<void>;
	readonly replayAfter: (
		sequence: PlotProtocolSequence,
	) => Effect.Effect<readonly PlotEventRecord[], PlotProtocolFailure>;
	readonly snapshot: () => Effect.Effect<PlotProtocolReplaySnapshot>;
	readonly lastSequence: () => Effect.Effect<PlotProtocolSequence>;
	readonly waitUntil: (sequence: PlotProtocolSequence) => Effect.Effect<void>;
}

const byteLength = (value: string) => new TextEncoder().encode(value).length;

const eventSequenceNumber = (record: PlotEventRecord) =>
	Number(record.sequence);

const trimEntries = (
	entries: readonly ReplayEntry[],
	limits: PlotProtocolLimits,
): readonly ReplayEntry[] => {
	let retained = [...entries];
	let totalBytes = retained.reduce((total, entry) => total + entry.bytes, 0);
	while (
		retained.length > limits.maxEventBufferEvents ||
		totalBytes > limits.maxEventBufferBytes
	) {
		const [first, ...rest] = retained;
		retained = rest;
		totalBytes -= first?.bytes ?? 0;
	}
	return retained;
};

const replaySnapshot = (state: ReplayState): PlotProtocolReplaySnapshot => {
	const first = state.entries[0];
	return {
		firstEventSeq: plotProtocolSequence(
			first === undefined
				? state.lastSequence
				: eventSequenceNumber(first.record),
		),
		lastEventSeq: plotProtocolSequence(state.lastSequence),
	};
};

const cursorExpired = (sequence: PlotProtocolSequence) =>
	new PlotProtocolFailure({
		code: "cursor_expired",
		message: "event cursor is no longer retained",
		details: { afterSequence: sequence },
	});

export const makePlotProtocolReplayBuffer = (
	limits: PlotProtocolLimits = defaultPlotProtocolLimits,
): Effect.Effect<PlotProtocolReplayBuffer> =>
	Effect.gen(function* () {
		const stateRef = yield* Ref.make<ReplayState>({
			entries: [],
			bytes: 0,
			lastSequence: 0,
			waiters: [],
		});

		const append = (record: PlotEventRecord) =>
			Effect.gen(function* () {
				const bytes = byteLength(JSON.stringify(record));
				const ready = yield* Ref.modify(stateRef, (state) => {
					const lastSequence = Math.max(
						state.lastSequence,
						eventSequenceNumber(record),
					);
					const withRecord =
						bytes > limits.maxEventBufferBytes
							? state.entries
							: [...state.entries, { record, bytes }];
					const entries = trimEntries(withRecord, limits);
					const retainedBytes = entries.reduce(
						(total, entry) => total + entry.bytes,
						0,
					);
					const readyWaiters = state.waiters.filter(
						(waiter) => waiter.sequence <= lastSequence,
					);
					const pendingWaiters = state.waiters.filter(
						(waiter) => waiter.sequence > lastSequence,
					);
					return [
						readyWaiters,
						{
							entries,
							bytes: retainedBytes,
							lastSequence,
							waiters: pendingWaiters,
						},
					] as const;
				});
				for (const waiter of ready) {
					yield* Deferred.succeed(waiter.deferred, undefined);
				}
			});

		const replayAfter = (sequence: PlotProtocolSequence) =>
			Effect.gen(function* () {
				const state = yield* Ref.get(stateRef);
				const after = Number(sequence);
				if (after >= state.lastSequence) return [];
				const first = state.entries[0];
				if (first === undefined) return yield* cursorExpired(sequence);
				const firstSequence = eventSequenceNumber(first.record);
				if (after < firstSequence - 1) return yield* cursorExpired(sequence);
				return state.entries
					.map((entry) => entry.record)
					.filter((record) => eventSequenceNumber(record) > after);
			});

		const snapshot = () => Ref.get(stateRef).pipe(Effect.map(replaySnapshot));
		const lastSequence = () =>
			Ref.get(stateRef).pipe(
				Effect.map((state) => plotProtocolSequence(state.lastSequence)),
			);

		const waitUntil = (sequence: PlotProtocolSequence) =>
			Effect.gen(function* () {
				const target = Number(sequence);
				const deferred = yield* Deferred.make<void>();
				const shouldWait = yield* Ref.modify(stateRef, (state) => {
					if (state.lastSequence >= target) return [false, state] as const;
					return [
						true,
						{
							...state,
							waiters: [...state.waiters, { sequence: target, deferred }],
						},
					] as const;
				});
				if (shouldWait) yield* Deferred.await(deferred);
			});

		return {
			append,
			replayAfter,
			snapshot,
			lastSequence,
			waitUntil,
		};
	});
