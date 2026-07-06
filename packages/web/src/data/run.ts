import type { RunRecord } from "@plot/registry/record";
import { asRecord } from "./parse.js";

export type PlotRun = RunRecord;

const parseRun = (value: unknown): PlotRun | undefined => {
	const record = asRecord(value);
	if (record === undefined) return undefined;
	if (typeof record["id"] !== "string") return undefined;
	if (typeof record["status"] !== "string") return undefined;
	if (typeof record["cwd"] !== "string") return undefined;
	return record as unknown as PlotRun;
};

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
