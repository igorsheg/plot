import { rm, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import {
	safeParsePlotSessionSummary,
	type PlotSessionSummary,
} from "@plot/control/session-summary";
import type { LocalPlotServerPaths } from "./local-server-paths.js";

export interface PlotSessionCatalogEntry {
	readonly sessionId: string;
	readonly workflowName: string;
	readonly workflowPath: string;
	readonly cwd: string;
	readonly cwdName: string;
	readonly historyPath: string;
	readonly summary: PlotSessionSummary;
	readonly lastSeenAt: string;
	readonly updatedAt: string;
	readonly stale?: boolean;
}

export interface PlotSessionCatalog {
	readonly version: 1;
	readonly entries: readonly PlotSessionCatalogEntry[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const parseEntry = (value: unknown): PlotSessionCatalogEntry | undefined => {
	if (!isRecord(value)) return undefined;
	const summary = safeParsePlotSessionSummary(value["summary"]);
	if (!summary.success) return undefined;
	if (typeof value["sessionId"] !== "string") return undefined;
	if (typeof value["workflowName"] !== "string") return undefined;
	if (typeof value["workflowPath"] !== "string") return undefined;
	if (typeof value["cwd"] !== "string") return undefined;
	if (typeof value["cwdName"] !== "string") return undefined;
	if (typeof value["historyPath"] !== "string") return undefined;
	if (typeof value["lastSeenAt"] !== "string") return undefined;
	if (typeof value["updatedAt"] !== "string") return undefined;
	return {
		sessionId: value["sessionId"],
		workflowName: value["workflowName"],
		workflowPath: value["workflowPath"],
		cwd: value["cwd"],
		cwdName: value["cwdName"],
		historyPath: value["historyPath"],
		summary: summary.data as PlotSessionSummary,
		lastSeenAt: value["lastSeenAt"],
		updatedAt: value["updatedAt"],
		...(value["stale"] === true ? { stale: true } : {}),
	};
};

const parseCatalog = (value: unknown): PlotSessionCatalog => {
	if (
		!isRecord(value) ||
		value["version"] !== 1 ||
		!Array.isArray(value["entries"])
	)
		return { version: 1, entries: [] };
	return {
		version: 1,
		entries: value["entries"]
			.map(parseEntry)
			.filter((entry) => entry !== undefined),
	};
};

const exists = async (path: string): Promise<boolean> => {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { readonly code?: unknown }).code === "ENOENT"
		)
			return false;
		throw error;
	}
};

export const readPlotSessionCatalog = async (
	paths: Pick<LocalPlotServerPaths, "catalogPath">,
): Promise<PlotSessionCatalog> => {
	try {
		return parseCatalog(
			JSON.parse(await readFile(paths.catalogPath, "utf8")) as unknown,
		);
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { readonly code?: unknown }).code === "ENOENT"
		)
			return { version: 1, entries: [] };
		return { version: 1, entries: [] };
	}
};

export const writePlotSessionCatalog = async (
	paths: Pick<LocalPlotServerPaths, "serverDir" | "catalogPath">,
	catalog: PlotSessionCatalog,
): Promise<void> => {
	await mkdir(paths.serverDir, { recursive: true, mode: 0o700 });
	await writeFile(paths.catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, {
		mode: 0o600,
	});
};

export const catalogEntryFromSummary = (input: {
	readonly summary: PlotSessionSummary;
	readonly historyPath: string;
	readonly now?: string;
}): PlotSessionCatalogEntry => {
	const now = input.now ?? new Date().toISOString();
	return {
		sessionId: input.summary.id,
		workflowName: input.summary.workflowName,
		workflowPath: input.summary.workflowPath,
		cwd: input.summary.cwd,
		cwdName: input.summary.cwdName,
		historyPath: input.historyPath,
		summary: input.summary,
		lastSeenAt: now,
		updatedAt: now,
	};
};

export const upsertPlotSessionCatalogEntry = async (
	paths: Pick<LocalPlotServerPaths, "serverDir" | "catalogPath">,
	entry: PlotSessionCatalogEntry,
): Promise<PlotSessionCatalog> => {
	const catalog = await readPlotSessionCatalog(paths);
	const entries = catalog.entries.filter(
		(existing) => existing.sessionId !== entry.sessionId,
	);
	entries.push(entry);
	const updated = { version: 1 as const, entries };
	await writePlotSessionCatalog(paths, updated);
	return updated;
};

export const refreshPlotSessionCatalogFromHistory = async (
	paths: Pick<LocalPlotServerPaths, "serverDir" | "catalogPath">,
): Promise<PlotSessionCatalog> => {
	const catalog = await readPlotSessionCatalog(paths);
	const entries = await Promise.all(
		catalog.entries.map(async (entry) => {
			if (await exists(entry.historyPath)) return { ...entry, stale: false };
			return { ...entry, stale: true };
		}),
	);
	const refreshed = { version: 1 as const, entries };
	await writePlotSessionCatalog(paths, refreshed);
	return refreshed;
};

const terminalPrunable = (entry: PlotSessionCatalogEntry): boolean =>
	entry.summary.mode === "oneshot" && entry.summary.state === "stopped";

export const applyStoppedOneshotRetention = async (input: {
	readonly paths: Pick<LocalPlotServerPaths, "serverDir" | "catalogPath">;
	readonly now?: string;
	readonly maxStoppedOneshot?: number;
	readonly maxAgeMs?: number;
}): Promise<{
	readonly catalog: PlotSessionCatalog;
	readonly pruned: readonly PlotSessionCatalogEntry[];
}> => {
	const nowMs = Date.parse(input.now ?? new Date().toISOString());
	const maxAgeMs = input.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
	const maxStoppedOneshot = input.maxStoppedOneshot ?? 100;
	const catalog = await readPlotSessionCatalog(input.paths);
	const stopped = catalog.entries
		.filter(terminalPrunable)
		.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
	const rank = new Map(stopped.map((entry, index) => [entry.sessionId, index]));
	const pruned: PlotSessionCatalogEntry[] = [];
	const kept: PlotSessionCatalogEntry[] = [];
	for (const entry of catalog.entries) {
		if (!terminalPrunable(entry)) {
			kept.push(entry);
			continue;
		}
		const entryRank = rank.get(entry.sessionId) ?? Number.POSITIVE_INFINITY;
		const ageMs = nowMs - Date.parse(entry.updatedAt);
		if (entryRank >= maxStoppedOneshot || ageMs > maxAgeMs) {
			pruned.push(entry);
			continue;
		}
		kept.push(entry);
	}
	for (const entry of pruned)
		await rm(dirname(entry.historyPath), { recursive: true, force: true });
	const updated = { version: 1 as const, entries: kept };
	await writePlotSessionCatalog(input.paths, updated);
	return { catalog: updated, pruned };
};
