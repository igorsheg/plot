/**
 * Event-rate pulse: an honest signal derived only from what the runs poll
 * actually reports. Each store change records `{ atMs, sequence }` for the
 * selected run; consecutive samples become an events/min series feeding the
 * header's live strip.
 *
 * The pure core (`pushSample`, `rateSeries`) is unit-tested. The module-local
 * nanostores below wire it to `$selectedRun` via nanostores lifecycle — no
 * component effects. The shared 1s clock lives in `app/store.ts` as `$nowMs`.
 */

import { atom, onMount } from "nanostores";
import { $selectedRun } from "../../app/store.js";
import type { LiveLinePoint } from "../ui/live-line/index.js";

export interface PulseSample {
	readonly atMs: number;
	readonly sequence: number;
}

export type PulseBuffer = readonly PulseSample[];

/** Samples retained per run; ~28 fill the visible window, a little slack. */
export const PULSE_CAP = 32;

/** Append a sample, keeping at most `PULSE_CAP` most-recent entries. */
export function pushSample(buf: PulseBuffer, sample: PulseSample): PulseBuffer {
	const next = [...buf, sample];
	return next.length > PULSE_CAP ? next.slice(next.length - PULSE_CAP) : next;
}

/**
 * Turn a sample buffer into an events/min series: each consecutive pair yields
 * `value = max(0, Δseq / Δmin)` at `time = atMs_b / 1000`. Zero/negative Δt and
 * negative Δseq (a registry restart) skip the pair.
 */
export function rateSeries(buf: PulseBuffer): LiveLinePoint[] {
	const series: LiveLinePoint[] = [];
	for (let i = 1; i < buf.length; i++) {
		const prev = buf[i - 1];
		const curr = buf[i];
		if (prev === undefined || curr === undefined) continue;
		const deltaMs = curr.atMs - prev.atMs;
		if (deltaMs <= 0) continue;
		const deltaSeq = curr.sequence - prev.sequence;
		if (deltaSeq < 0) continue;
		const deltaMin = deltaMs / 60_000;
		series.push({
			time: curr.atMs / 1000,
			value: Math.max(0, deltaSeq / deltaMin),
		});
	}
	return series;
}

/** Latest events/min — the live tip value. */
export function latestRate(series: readonly LiveLinePoint[]): number {
	const tip = series[series.length - 1];
	return tip === undefined ? 0 : tip.value;
}

export const $pulseSeries = atom<readonly LiveLinePoint[]>([]);
export const $pulseRate = atom<number>(0);

let buffer: PulseBuffer = [];
let bufferRunId: string | undefined;

onMount($pulseSeries, () => {
	return $selectedRun.subscribe((run) => {
		if (run === undefined) return;
		if (run.id !== bufferRunId) {
			bufferRunId = run.id;
			buffer = [];
		}
		buffer = pushSample(buffer, {
			atMs: Date.now(),
			sequence: run.lastSequence ?? 0,
		});
		const series = rateSeries(buffer);
		$pulseSeries.set(series);
		$pulseRate.set(latestRate(series));
	});
});
