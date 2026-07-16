import {
	isActiveSession,
	parseSessionSummary,
	type SessionSummary,
} from "@plot/session-manager/session";
import { asRecord } from "./parse.js";

const parseSession = (value: unknown): SessionSummary | undefined => {
	try {
		return parseSessionSummary(value);
	} catch {
		return undefined;
	}
};

export const parseSessions = (value: unknown): readonly SessionSummary[] => {
	const record = asRecord(value);
	const rows = Array.isArray(value)
		? value
		: Array.isArray(record?.["sessions"])
			? record["sessions"]
			: [];
	return rows.map(parseSession).filter((entry) => entry !== undefined);
};

export { isActiveSession };
