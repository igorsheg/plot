import { isRecord } from "@plot/common/primitives";

export type RunStatus =
	| "starting"
	| "online"
	| "stopping"
	| "stopped"
	| "error";

export interface RunRecord {
	readonly id: string;
	readonly status: RunStatus;
	readonly cwd: string;
	readonly cwdName?: string;
	readonly createdAt: string;
	readonly lastSeenAt?: string;
	readonly label?: string;
	readonly pid?: number;
	readonly sessionId?: string;
	readonly workflowName?: string;
	readonly workflowPath?: string;
	readonly sessionDir?: string;
	readonly lastSequence?: number;
	readonly lastEventType?: string;
	readonly stderrTail?: string;
}

const runStatuses = new Set([
	"starting",
	"online",
	"stopping",
	"stopped",
	"error",
]);

const optionalStringKeys = [
	"cwdName",
	"lastSeenAt",
	"label",
	"sessionId",
	"workflowName",
	"workflowPath",
	"sessionDir",
	"lastEventType",
	"stderrTail",
] as const;

type MutableRunRecord = { -readonly [K in keyof RunRecord]?: RunRecord[K] };

export const cloneRunRecord = (record: RunRecord): RunRecord => ({ ...record });

/** Validate a row read back from the run store file (untrusted: hand-edited or corrupt). */
export const parseRunRecord = (value: unknown): RunRecord => {
	if (!isRecord(value)) throw new Error("run record must be an object");
	const id = value["id"];
	const status = value["status"];
	const cwd = value["cwd"];
	const createdAt = value["createdAt"];
	if (typeof id !== "string" || id.length === 0)
		throw new Error("run record id must be a non-empty string");
	if (typeof status !== "string" || !runStatuses.has(status))
		throw new Error(`run record ${id} has unknown status: ${String(status)}`);
	if (typeof cwd !== "string" || cwd.length === 0)
		throw new Error(`run record ${id} cwd must be a non-empty string`);
	if (typeof createdAt !== "string" || createdAt.length === 0)
		throw new Error(`run record ${id} createdAt must be a non-empty string`);
	const record: MutableRunRecord = {
		id,
		status: status as RunStatus,
		cwd,
		createdAt,
	};
	for (const key of optionalStringKeys) {
		const field = value[key];
		if (typeof field === "string" && field.length > 0) record[key] = field;
	}
	const pid = value["pid"];
	if (typeof pid === "number" && Number.isInteger(pid) && pid > 0)
		record.pid = pid;
	const lastSequence = value["lastSequence"];
	if (
		typeof lastSequence === "number" &&
		Number.isInteger(lastSequence) &&
		lastSequence > 0
	)
		record.lastSequence = lastSequence;
	return record as RunRecord;
};

export const parseRunRecords = (value: unknown): readonly RunRecord[] => {
	if (!Array.isArray(value))
		throw new Error("run store must contain an array of run records");
	return value.map(parseRunRecord);
};
