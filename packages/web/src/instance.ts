export interface PlotInstance {
	readonly id: string;
	readonly status: string;
	readonly cwd: string;
	readonly createdAt: string;
	readonly lastSeenAt?: string | undefined;
	readonly label?: string | undefined;
	readonly sessionId?: string | undefined;
	readonly workflowName?: string | undefined;
	readonly workflowPath?: string | undefined;
	readonly cwdName?: string | undefined;
	readonly sessionDir?: string | undefined;
	readonly eventLogPath?: string | undefined;
	readonly lastSequence?: number | undefined;
	readonly lastEventType?: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const stringAt = (record: Record<string, unknown>, key: string) =>
	typeof record[key] === "string" ? record[key] : undefined;

const numberAt = (record: Record<string, unknown>, key: string) =>
	typeof record[key] === "number" ? record[key] : undefined;

const parseInstance = (value: unknown): PlotInstance | undefined => {
	if (!isRecord(value)) return undefined;
	const id = stringAt(value, "id");
	const status = stringAt(value, "status");
	const cwd = stringAt(value, "cwd");
	const createdAt = stringAt(value, "createdAt");
	if (
		id === undefined ||
		status === undefined ||
		cwd === undefined ||
		createdAt === undefined
	)
		return undefined;
	return {
		id,
		status,
		cwd,
		createdAt,
		...(stringAt(value, "lastSeenAt") === undefined
			? {}
			: { lastSeenAt: stringAt(value, "lastSeenAt") }),
		...(stringAt(value, "label") === undefined
			? {}
			: { label: stringAt(value, "label") }),
		...(stringAt(value, "sessionId") === undefined
			? {}
			: { sessionId: stringAt(value, "sessionId") }),
		...(stringAt(value, "workflowName") === undefined
			? {}
			: { workflowName: stringAt(value, "workflowName") }),
		...(stringAt(value, "workflowPath") === undefined
			? {}
			: { workflowPath: stringAt(value, "workflowPath") }),
		...(stringAt(value, "cwdName") === undefined
			? {}
			: { cwdName: stringAt(value, "cwdName") }),
		...(stringAt(value, "sessionDir") === undefined
			? {}
			: { sessionDir: stringAt(value, "sessionDir") }),
		...(stringAt(value, "eventLogPath") === undefined
			? {}
			: { eventLogPath: stringAt(value, "eventLogPath") }),
		...(numberAt(value, "lastSequence") === undefined
			? {}
			: { lastSequence: numberAt(value, "lastSequence") }),
		...(stringAt(value, "lastEventType") === undefined
			? {}
			: { lastEventType: stringAt(value, "lastEventType") }),
	};
};

export const parsePlotInstances = (value: unknown): readonly PlotInstance[] => {
	if (Array.isArray(value))
		return value.map(parseInstance).filter((entry) => entry !== undefined);
	if (isRecord(value) && Array.isArray(value["instances"]))
		return value["instances"]
			.map(parseInstance)
			.filter((entry) => entry !== undefined);
	return [];
};
