import { parseRunRecord, type RunRecord } from "@plot/registry/record";
import { asRecord } from "./parse.js";

const parseRun = (value: unknown): RunRecord | undefined => {
	try {
		return parseRunRecord(value);
	} catch {
		return undefined;
	}
};

export const parsePlotRuns = (value: unknown): readonly RunRecord[] => {
	const record = asRecord(value);
	const rows = Array.isArray(value)
		? value
		: Array.isArray(record?.["runs"])
			? record["runs"]
			: [];
	return rows.map(parseRun).filter((entry) => entry !== undefined);
};

export const isRunLive = (run: RunRecord): boolean =>
	run.status !== "stopped" && run.status !== "error";
