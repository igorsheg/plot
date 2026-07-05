import { runRecordSchema, type RunRecord } from "@plot/session/run-record";
import { Option, Schema } from "effect";
import { asRecord } from "./parse.js";

export type PlotRun = RunRecord;

const decodeRun = Schema.decodeUnknownOption(runRecordSchema);

const parseRun = (value: unknown): PlotRun | undefined =>
	Option.getOrUndefined(decodeRun(value));

export const parsePlotRuns = (value: unknown): readonly PlotRun[] => {
	const record = asRecord(value);
	const rows = Array.isArray(value)
		? value
		: Array.isArray(record?.["runs"])
			? record["runs"]
			: [];
	return rows.map(parseRun).filter((entry) => entry !== undefined);
};

export const isRunLive = (run: PlotRun): boolean =>
	run.status !== "stopped" && run.status !== "error";
