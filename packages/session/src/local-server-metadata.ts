import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { LocalPlotServerPaths } from "./local-server-paths.js";

export const defaultLocalPlotServerPort = 3927;
export const localPlotServerVersion = "0.0.0";

export interface LocalPlotServerMetadata {
	readonly id: string;
	readonly version: string;
	readonly url: string;
	readonly pid: number;
	readonly startedAt: string;
	readonly tokenFingerprint: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

export const parseLocalPlotServerMetadata = (
	value: unknown,
): LocalPlotServerMetadata | undefined => {
	if (!isRecord(value)) return undefined;
	if (typeof value["id"] !== "string") return undefined;
	if (typeof value["version"] !== "string") return undefined;
	if (typeof value["url"] !== "string") return undefined;
	if (typeof value["pid"] !== "number") return undefined;
	if (typeof value["startedAt"] !== "string") return undefined;
	if (typeof value["tokenFingerprint"] !== "string") return undefined;
	return {
		id: value["id"],
		version: value["version"],
		url: value["url"],
		pid: value["pid"],
		startedAt: value["startedAt"],
		tokenFingerprint: value["tokenFingerprint"],
	};
};

export const readLocalPlotServerMetadata = async (
	paths: Pick<LocalPlotServerPaths, "metadataPath">,
): Promise<LocalPlotServerMetadata | undefined> => {
	try {
		return parseLocalPlotServerMetadata(
			JSON.parse(await readFile(paths.metadataPath, "utf8")) as unknown,
		);
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { readonly code?: unknown }).code === "ENOENT"
		)
			return undefined;
		return undefined;
	}
};

export const writeLocalPlotServerMetadata = async (
	paths: Pick<LocalPlotServerPaths, "serverDir" | "metadataPath">,
	metadata: LocalPlotServerMetadata,
): Promise<void> => {
	await mkdir(paths.serverDir, { recursive: true, mode: 0o700 });
	const temp = `${paths.metadataPath}.${metadata.id}.tmp`;
	await writeFile(temp, `${JSON.stringify(metadata, null, 2)}\n`, {
		mode: 0o600,
	});
	await rename(temp, paths.metadataPath);
};

/** Remove the server metadata file so probes stop seeing a stopped server. */
export const removeLocalPlotServerMetadata = async (
	paths: Pick<LocalPlotServerPaths, "metadataPath">,
): Promise<void> => {
	await rm(paths.metadataPath, { force: true });
};

export const sameLocalPlotServerRegistration = (
	left: LocalPlotServerMetadata,
	right: LocalPlotServerMetadata,
): boolean =>
	left.id === right.id &&
	left.version === right.version &&
	left.url === right.url &&
	left.pid === right.pid;

export const removeLocalPlotServerMetadataIfMatches = async (
	paths: Pick<LocalPlotServerPaths, "metadataPath">,
	metadata: LocalPlotServerMetadata,
): Promise<void> => {
	const current = await readLocalPlotServerMetadata(paths);
	if (
		current !== undefined &&
		sameLocalPlotServerRegistration(current, metadata)
	)
		await rm(paths.metadataPath, { force: true });
};

export interface LocalPlotServerHealth {
	readonly ok: true;
	readonly name: "plot-local-server";
	readonly id: string;
	readonly version: string;
	readonly pid: number;
	readonly startedAt: string;
	readonly tokenFingerprint: string;
}

export const healthCheckLocalPlotServer = async (input: {
	readonly url: string;
	readonly token: string;
	readonly expectedTokenFingerprint?: string;
	readonly timeoutMs?: number;
}): Promise<LocalPlotServerHealth | undefined> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 500);
	try {
		const response = await fetch(new URL("/health", input.url), {
			headers: { authorization: `Bearer ${input.token}` },
			signal: controller.signal,
		});
		if (!response.ok) return undefined;
		const body = (await response.json()) as unknown;
		if (!isRecord(body)) return undefined;
		if (body["ok"] !== true || body["name"] !== "plot-local-server")
			return undefined;
		if (typeof body["id"] !== "string") return undefined;
		if (typeof body["version"] !== "string") return undefined;
		if (typeof body["pid"] !== "number") return undefined;
		if (typeof body["startedAt"] !== "string") return undefined;
		if (typeof body["tokenFingerprint"] !== "string") return undefined;
		if (body["version"] !== localPlotServerVersion) return undefined;
		if (
			input.expectedTokenFingerprint !== undefined &&
			body["tokenFingerprint"] !== input.expectedTokenFingerprint
		)
			return undefined;
		return {
			ok: true,
			name: "plot-local-server",
			id: body["id"],
			version: body["version"],
			pid: body["pid"],
			startedAt: body["startedAt"],
			tokenFingerprint: body["tokenFingerprint"],
		};
	} catch {
		return undefined;
	} finally {
		clearTimeout(timeout);
	}
};

export const discoverHealthyLocalPlotServer = async (input: {
	readonly paths: Pick<LocalPlotServerPaths, "metadataPath">;
	readonly token: string;
	readonly tokenFingerprint: string;
}): Promise<LocalPlotServerMetadata | undefined> => {
	const metadata = await readLocalPlotServerMetadata(input.paths);
	if (!metadata) return undefined;
	if (metadata.version !== localPlotServerVersion) return undefined;
	if (metadata.tokenFingerprint !== input.tokenFingerprint) return undefined;
	const health = await healthCheckLocalPlotServer({
		url: metadata.url,
		token: input.token,
		expectedTokenFingerprint: input.tokenFingerprint,
	});
	return health ? metadata : undefined;
};
