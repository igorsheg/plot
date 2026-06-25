import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

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
	readonly eventLogOffset?: number | undefined;
	readonly lastEventType?: string | undefined;
}

export const resolvePlotSessionDiscoveryDir = (options: {
	readonly agentDir: string;
}): string => resolve(dirname(resolve(options.agentDir)), "discovery");

export const plotSessionRegistrationKey = (input: {
	readonly cwd: string;
	readonly sessionId: string;
}): string =>
	createHash("sha256")
		.update(`${resolve(input.cwd)}\0${input.sessionId}`)
		.digest("hex")
		.slice(0, 24);

export const plotSessionRegistrationPath = (input: {
	readonly discoveryDir: string;
	readonly key: string;
}): string => join(input.discoveryDir, `${input.key}.json`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const stringAt = (record: Record<string, unknown>, key: string) =>
	typeof record[key] === "string" ? record[key] : undefined;

export const parsePlotSessionRegistration = (
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
		...(typeof value["eventLogOffset"] === "number"
			? { eventLogOffset: value["eventLogOffset"] }
			: {}),
		...(stringAt(value, "lastEventType") === undefined
			? {}
			: { lastEventType: stringAt(value, "lastEventType") }),
	};
};

export const writePlotSessionRegistration = async (input: {
	readonly discoveryDir: string;
	readonly registration: PlotSessionRegistration;
}): Promise<void> => {
	await mkdir(input.discoveryDir, { recursive: true, mode: 0o700 });
	const path = plotSessionRegistrationPath({
		discoveryDir: input.discoveryDir,
		key: input.registration.key,
	});
	const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temp, `${JSON.stringify(input.registration, null, 2)}\n`, {
		mode: 0o600,
	});
	await rename(temp, path);
};

export const removePlotSessionRegistration = async (input: {
	readonly discoveryDir: string;
	readonly key: string;
}): Promise<void> => {
	await rm(
		plotSessionRegistrationPath({
			discoveryDir: input.discoveryDir,
			key: input.key,
		}),
		{ force: true },
	);
};

const readRegistrationFile = async (
	path: string,
): Promise<PlotSessionRegistration | undefined> => {
	try {
		return parsePlotSessionRegistration(
			JSON.parse(await readFile(path, "utf8")) as unknown,
		);
	} catch {
		return undefined;
	}
};

export const readPlotSessionRegistrations = async (input: {
	readonly discoveryDir: string;
}): Promise<readonly PlotSessionRegistration[]> => {
	let names: readonly string[] = [];
	try {
		names = await readdir(input.discoveryDir);
	} catch {
		return [];
	}
	const registrations = await Promise.all(
		names
			.filter((name) => name.endsWith(".json"))
			.map((name) => readRegistrationFile(join(input.discoveryDir, name))),
	);
	return registrations.filter((entry) => entry !== undefined);
};

export const isProcessAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

export const isLivePlotSessionRegistration = (
	registration: PlotSessionRegistration,
	_nowMs = Date.now(),
	_maxHeartbeatAgeMs = 10_000,
): boolean => isProcessAlive(registration.pid);

export const readLivePlotSessionRegistrations = async (input: {
	readonly discoveryDir: string;
	readonly nowMs?: number;
	readonly maxHeartbeatAgeMs?: number;
}): Promise<readonly PlotSessionRegistration[]> =>
	(
		await readPlotSessionRegistrations({ discoveryDir: input.discoveryDir })
	).filter((registration) =>
		isLivePlotSessionRegistration(
			registration,
			input.nowMs,
			input.maxHeartbeatAgeMs,
		),
	);
