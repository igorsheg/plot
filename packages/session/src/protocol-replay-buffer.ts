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
	readonly resolve: () => void;
}
interface ReplayState {
	entries: ReplayEntry[];
	bytes: number;
	lastSequence: number;
	waiters: ReplayWaiter[];
}
export interface PlotProtocolReplaySnapshot {
	readonly firstEventSeq: PlotProtocolSequence;
	readonly lastEventSeq: PlotProtocolSequence;
}
export interface PlotProtocolReplayBuffer {
	readonly append: (record: PlotEventRecord) => Promise<void>;
	readonly replayAfter: (
		sequence: PlotProtocolSequence,
	) => Promise<readonly PlotEventRecord[]>;
	readonly snapshot: () => Promise<PlotProtocolReplaySnapshot>;
	readonly lastSequence: () => Promise<PlotProtocolSequence>;
	readonly waitUntil: (sequence: PlotProtocolSequence) => Promise<void>;
}
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const eventSequenceNumber = (record: PlotEventRecord) =>
	Number(record.sequence);
const cursorExpired = (sequence: PlotProtocolSequence) =>
	new PlotProtocolFailure({
		code: "cursor_expired",
		message: "event cursor is no longer retained",
		details: { afterSequence: sequence },
	});
export const makePlotProtocolReplayBuffer = async (
	limits: PlotProtocolLimits = defaultPlotProtocolLimits,
): Promise<PlotProtocolReplayBuffer> => {
	const state: ReplayState = {
		entries: [],
		bytes: 0,
		lastSequence: 0,
		waiters: [],
	};
	const trim = () => {
		while (
			state.entries.length > limits.maxEventBufferEvents ||
			state.bytes > limits.maxEventBufferBytes
		) {
			const first = state.entries.shift();
			state.bytes -= first?.bytes ?? 0;
		}
	};
	const replaySnapshot = (): PlotProtocolReplaySnapshot => ({
		firstEventSeq: plotProtocolSequence(
			state.entries[0] === undefined
				? state.lastSequence
				: eventSequenceNumber(state.entries[0].record),
		),
		lastEventSeq: plotProtocolSequence(state.lastSequence),
	});
	return {
		append: async (record) => {
			const bytes = byteLength(JSON.stringify(record));
			state.lastSequence = Math.max(
				state.lastSequence,
				eventSequenceNumber(record),
			);
			if (bytes <= limits.maxEventBufferBytes) {
				state.entries.push({ record, bytes });
				state.bytes += bytes;
				trim();
			}
			const ready = state.waiters.filter(
				(w) => w.sequence <= state.lastSequence,
			);
			state.waiters = state.waiters.filter(
				(w) => w.sequence > state.lastSequence,
			);
			for (const waiter of ready) waiter.resolve();
		},
		replayAfter: async (sequence) => {
			const after = Number(sequence);
			if (after >= state.lastSequence) return [];
			const first = state.entries[0];
			if (first === undefined) throw cursorExpired(sequence);
			const firstSequence = eventSequenceNumber(first.record);
			if (after < firstSequence - 1) throw cursorExpired(sequence);
			return state.entries
				.map((e) => e.record)
				.filter((r) => eventSequenceNumber(r) > after);
		},
		snapshot: async () => replaySnapshot(),
		lastSequence: async () => plotProtocolSequence(state.lastSequence),
		waitUntil: async (sequence) => {
			const target = Number(sequence);
			if (state.lastSequence >= target) return;
			await new Promise<void>((resolve) =>
				state.waiters.push({ sequence: target, resolve }),
			);
		},
	};
};
