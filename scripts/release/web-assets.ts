#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { cliWebAssetsGenerated, webPackageDir } from "./shared.js";

const contentTypes = new Map([
	[".css", "text/css; charset=utf-8"],
	[".html", "text/html; charset=utf-8"],
	[".js", "text/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".svg", "image/svg+xml"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
]);

const distDir = join(webPackageDir, "dist");
const indexPath = join(distDir, "index.html");

export function generateEmbeddedWebAssets() {
	const indexHtml = readFileSync(indexPath, "utf8");
	const files = walkFiles(distDir)
		.filter((path) => path !== indexPath)
		.sort();
	const assets = files.map((path) => ({
		path: `/${relative(distDir, path).replaceAll("\\", "/")}`,
		contentType: contentTypes.get(extname(path)) ?? "application/octet-stream",
		bodyBase64: readFileSync(path).toString("base64"),
	}));
	writeFileSync(
		cliWebAssetsGenerated,
		[
			"export const embeddedPlotWebAssets = ",
			JSON.stringify({ indexHtml, assets }, null, "\t"),
			" as const;\n",
		].join(""),
	);
	const formatted = spawnSync("oxfmt", [cliWebAssetsGenerated], {
		stdio: "inherit",
	});
	if (formatted.error) throw formatted.error;
	if (formatted.status !== 0)
		throw new Error(`oxfmt failed for ${cliWebAssetsGenerated}`);
}

function walkFiles(root: string, directory = root): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? walkFiles(root, path) : [path];
	});
}

if (import.meta.main) generateEmbeddedWebAssets();
