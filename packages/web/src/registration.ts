export interface PlotSessionRegistration {
	readonly version: 1;
	readonly key: string;
	readonly sessionId: string;
	readonly workflowName: string;
	readonly workflowPath: string;
	readonly cwd: string;
	readonly cwdName: string;
	readonly sessionDir: string;
	readonly eventLogPath: string;
	readonly pid: number;
	readonly startedAt: string;
	readonly heartbeatAt: string;
	readonly lastSequence: number;
	readonly lastEventType?: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const stringAt = (record: Record<string, unknown>, key: string) =>
	typeof record[key] === "string" ? record[key] : undefined;

const parseRegistration = (
	value: unknown,
): PlotSessionRegistration | undefined => {
	if (!isRecord(value) || value["version"] !== 1) return undefined;
	const key = stringAt(value, "key");
	const sessionId = stringAt(value, "sessionId");
	const workflowName = stringAt(value, "workflowName");
	const workflowPath = stringAt(value, "workflowPath");
	const cwd = stringAt(value, "cwd");
	const cwdName = stringAt(value, "cwdName");
	const sessionDir = stringAt(value, "sessionDir");
	const eventLogPath = stringAt(value, "eventLogPath");
	const startedAt = stringAt(value, "startedAt");
	const heartbeatAt = stringAt(value, "heartbeatAt");
	if (
		key === undefined ||
		sessionId === undefined ||
		workflowName === undefined ||
		workflowPath === undefined ||
		cwd === undefined ||
		cwdName === undefined ||
		sessionDir === undefined ||
		eventLogPath === undefined ||
		startedAt === undefined ||
		heartbeatAt === undefined ||
		typeof value["pid"] !== "number" ||
		typeof value["lastSequence"] !== "number"
	)
		return undefined;
	return {
		version: 1,
		key,
		sessionId,
		workflowName,
		workflowPath,
		cwd,
		cwdName,
		sessionDir,
		eventLogPath,
		pid: value["pid"],
		startedAt,
		heartbeatAt,
		lastSequence: value["lastSequence"],
		...(stringAt(value, "lastEventType") === undefined
			? {}
			: { lastEventType: stringAt(value, "lastEventType") }),
	};
};

export const parsePlotSessionRegistrations = (
	value: unknown,
): readonly PlotSessionRegistration[] => {
	if (Array.isArray(value))
		return value.map(parseRegistration).filter((entry) => entry !== undefined);
	if (isRecord(value) && Array.isArray(value["sessions"]))
		return value["sessions"]
			.map(parseRegistration)
			.filter((entry) => entry !== undefined);
	return [];
};
