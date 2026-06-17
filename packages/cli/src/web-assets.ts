import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { embeddedPlotWebAssets } from "./web-assets.generated.js";

export interface PlotWebAsset {
	readonly path: string;
	readonly contentType: string;
	readonly body: string | Uint8Array;
}

export interface PlotWebAssets {
	readonly indexHtml: string;
	readonly assets: readonly PlotWebAsset[];
}

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

const fromEmbedded = (): PlotWebAssets | undefined => {
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

const readFromDist = async (distDir: string): Promise<PlotWebAssets> => {
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

const isMissing = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as { readonly code?: unknown }).code === "ENOENT";

export const tryLoadPlotWebAssets = async (): Promise<
	PlotWebAssets | undefined
> => {
	// Prefer a freshly built local web/dist so `bun run build` is reflected
	// immediately in dev. A published CLI has no sibling web/dist (ENOENT), so it
	// falls back to the bundle embedded at release time.
	try {
		return await readFromDist(localDistDir());
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
	return fromEmbedded();
};

export const loadPlotWebAssets = async (): Promise<PlotWebAssets> => {
	const assets = await tryLoadPlotWebAssets();
	if (assets === undefined)
		throw new Error(
			"Plot web assets are not built. Run `cd packages/web && bun run build`, or use a release build that bundles the web assets.",
		);
	return assets;
};
