#!/usr/bin/env bun

import { $ } from "bun";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const root = join(import.meta.dir, "..", "packages", "web", "dist");
const out = join(
	import.meta.dir,
	"..",
	"packages",
	"gateway",
	"src",
	"web-assets.generated.ts",
);

const contentType = (path: string): string => {
	const ext = extname(path);
	if (ext === ".html") return "text/html; charset=utf-8";
	if (ext === ".js") return "text/javascript; charset=utf-8";
	if (ext === ".css") return "text/css; charset=utf-8";
	if (ext === ".svg") return "image/svg+xml";
	if (ext === ".png") return "image/png";
	if (ext === ".woff2") return "font/woff2";
	return "application/octet-stream";
};

const walk = async (dir: string): Promise<readonly string[]> => {
	const names = await readdir(dir);
	const nested = await Promise.all(
		names.map(async (name) => {
			const path = join(dir, name);
			return (await stat(path)).isDirectory() ? walk(path) : [path];
		}),
	);
	return nested.flat();
};

const files = await walk(root);
const entries = await Promise.all(
	files.map(async (path) => {
		const webPath = `/${relative(root, path).split(sep).join("/")}`;
		return [
			webPath,
			{
				contentType: contentType(path),
				bodyBase64: (await readFile(path)).toString("base64"),
			},
		] as const;
	}),
);

await writeFile(
	out,
	`export interface WebAsset {\n\treadonly contentType: string;\n\treadonly bodyBase64: string;\n}\n\nexport const webAssets = ${JSON.stringify(Object.fromEntries(entries), null, "\t")} satisfies Record<string, WebAsset>;\n`,
);
await $`oxfmt ${out}`;
