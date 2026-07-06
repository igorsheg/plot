import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hasErrnoCode, isRecord } from "@plot/common/primitives";
import { cloneRunRecord, parseRunRecords, type RunRecord } from "./record.js";

export interface RunStore {
	readonly list: () => Promise<readonly RunRecord[]>;
	readonly get: (id: string) => Promise<RunRecord | undefined>;
	readonly upsert: (record: RunRecord) => Promise<void>;
	readonly remove: (id: string) => Promise<void>;
	readonly recoverAfterRestart: () => Promise<void>;
}

export const stripTrailingNuls = (text: string): string => {
	let end = text.length;
	while (end > 0 && text.charCodeAt(end - 1) === 0) end--;
	return text.slice(0, end);
};

export const parseRunStoreJson = (text: string): readonly RunRecord[] => {
	const value = JSON.parse(stripTrailingNuls(text)) as unknown;
	if (Array.isArray(value)) {
		for (const row of value) {
			if (!isRecord(row)) continue;
			delete row["eventLogPath"];
		}
	}
	return parseRunRecords(value);
};

export const readJson = async (path: string): Promise<readonly RunRecord[]> => {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (hasErrnoCode(error, "ENOENT")) return [];
		throw error;
	}
	try {
		return parseRunStoreJson(text);
	} catch (error) {
		const lastCompleteRecord = stripTrailingNuls(text).lastIndexOf("\n  }");
		if (lastCompleteRecord === -1) throw error;
		return parseRunStoreJson(`${text.slice(0, lastCompleteRecord + 4)}\n]\n`);
	}
};

export const createFileRunStore = (path: string): RunStore => {
	let pendingWrite: Promise<void> = Promise.resolve();
	const mutate = async (work: () => Promise<void>) => {
		const next = pendingWrite.then(work, work);
		pendingWrite = next.catch(() => undefined);
		await next;
	};
	const writeRecords = async (records: readonly RunRecord[]) => {
		await mkdir(dirname(path), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		await writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`);
		await rename(tmp, path);
	};
	return {
		list: async () => readJson(path),
		get: async (id) =>
			(await readJson(path)).find((record) => record.id === id),
		upsert: (record) =>
			mutate(async () => {
				const records = [...(await readJson(path))];
				const index = records.findIndex((item) => item.id === record.id);
				if (index === -1) records.push(record);
				else records[index] = record;
				await writeRecords(records);
			}),
		remove: (id) =>
			mutate(async () => {
				await writeRecords(
					(await readJson(path)).filter((record) => record.id !== id),
				);
			}),
		recoverAfterRestart: () =>
			mutate(async () => {
				const recoveredAt = new Date().toISOString();
				await writeRecords(
					(await readJson(path)).map((record) => ({
						...record,
						status:
							record.status === "online" || record.status === "starting"
								? "stopped"
								: record.status,
						lastSeenAt: recoveredAt,
					})),
				);
			}),
	};
};

export const createMemoryRunStore = (
	initial: readonly RunRecord[] = [],
): RunStore => {
	const records = new Map(
		initial.map((record) => [record.id, cloneRunRecord(record)]),
	);
	return {
		list: async () => [...records.values()].map(cloneRunRecord),
		get: async (id) => {
			const record = records.get(id);
			return record === undefined ? undefined : cloneRunRecord(record);
		},
		upsert: async (record) => {
			records.set(record.id, cloneRunRecord(record));
		},
		remove: async (id) => {
			records.delete(id);
		},
		recoverAfterRestart: async () => {
			const lastSeenAt = new Date().toISOString();
			for (const [id, record] of records)
				records.set(id, {
					...record,
					status:
						record.status === "online" || record.status === "starting"
							? "stopped"
							: record.status,
					lastSeenAt,
				});
		},
	};
};
