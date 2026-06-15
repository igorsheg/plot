import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalPlotWebAssets } from "@plot/session/local-server";
import { embeddedPlotWebAssets } from "./web-assets.generated.js";

const contentTypes = new Map([
	[".css", "text/css; charset=utf-8"],
	[".html", "text/html; charset=utf-8"],
	[".js", "text/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".svg", "image/svg+xml"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
]);

const contentTypeFor = (path: string): string =>
	contentTypes.get(extname(path)) ?? "application/octet-stream";

const decodeBase64 = (value: string): Uint8Array =>
	new Uint8Array(Buffer.from(value, "base64"));

const fromEmbedded = (): LocalPlotWebAssets | undefined => {
	if (embeddedPlotWebAssets === undefined) return undefined;
	return {
		indexHtml: embeddedPlotWebAssets.indexHtml,
		assets: embeddedPlotWebAssets.assets.map((asset) => ({
			path: asset.path,
			contentType: asset.contentType,
			body: decodeBase64(asset.bodyBase64),
		})),
	};
};

const localDistDir = () =>
	join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");

const walkFiles = async (root: string, directory = root): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? walkFiles(root, path) : [path];
		}),
	);
	return files.flat();
};

const readFromDist = async (distDir: string): Promise<LocalPlotWebAssets> => {
	const indexPath = join(distDir, "index.html");
	const indexHtml = await readFile(indexPath, "utf8");
	const files = (await walkFiles(distDir)).filter((path) => path !== indexPath);
	const assets = await Promise.all(
		files.map(async (path) => ({
			path: `/${relative(distDir, path).replaceAll("\\", "/")}`,
			contentType: contentTypeFor(path),
			body: await readFile(path),
		})),
	);
	return { indexHtml, assets };
};

export const tryLoadPlotWebAssets = async (): Promise<
	LocalPlotWebAssets | undefined
> => {
	const embedded = fromEmbedded();
	if (embedded !== undefined) return embedded;
	try {
		return await readFromDist(localDistDir());
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { readonly code?: unknown }).code === "ENOENT"
		)
			return undefined;
		throw error;
	}
};

export const loadPlotWebAssets = async (): Promise<LocalPlotWebAssets> => {
	const assets = await tryLoadPlotWebAssets();
	if (assets === undefined)
		throw new Error(
			"Plot web assets are not built. Run `cd packages/web && bun run build`, or use a release build that bundles the web assets.",
		);
	return assets;
};
