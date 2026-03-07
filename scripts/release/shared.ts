#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const repoDir = join(scriptDir, "../..");
export const releaseDir = join(repoDir, "dist/release");
export const plotAiTemplateDir = join(repoDir, "packages/plot-ai");
export const webDistDir = join(repoDir, "packages/web/dist");
export const piSkillsDir = join(repoDir, "packages/pi-package/skills");

export const plotAiTemplate = readJson(
	join(plotAiTemplateDir, "package.json"),
) as {
	name: string;
	version: string;
	license: string;
	description: string;
	repository: { type: string; url: string };
	homepage: string;
	bugs: { url: string };
	engines: { node: string };
	keywords: string[];
	publishConfig?: { access?: string };
};

export const tuiPackage = readJson(
	join(repoDir, "packages/tui/package.json"),
) as {
	dependencies: {
		"@opentui/core": string;
	};
};

export const version = process.env["PLOT_VERSION"] ?? plotAiTemplate.version;
export const channel = process.env["PLOT_CHANNEL"] ?? "latest";
export const dryRun =
	process.argv.includes("--dry-run") || process.env["PLOT_DRY_RUN"] === "1";

export const releaseTargets = [
	{
		packageName: "@plot/cli-darwin-arm64",
		dirName: "plot-cli-darwin-arm64",
		bunTarget: "bun-darwin-arm64",
		os: ["darwin"],
		cpu: ["arm64"],
		binName: "plot-ai",
	},
	{
		packageName: "@plot/cli-darwin-x64",
		dirName: "plot-cli-darwin-x64",
		bunTarget: "bun-darwin-x64",
		os: ["darwin"],
		cpu: ["x64"],
		binName: "plot-ai",
	},
	{
		packageName: "@plot/cli-linux-arm64-gnu",
		dirName: "plot-cli-linux-arm64-gnu",
		bunTarget: "bun-linux-arm64",
		os: ["linux"],
		cpu: ["arm64"],
		binName: "plot-ai",
	},
	{
		packageName: "@plot/cli-linux-x64-gnu",
		dirName: "plot-cli-linux-x64-gnu",
		bunTarget: "bun-linux-x64",
		os: ["linux"],
		cpu: ["x64"],
		binName: "plot-ai",
	},
	{
		packageName: "@plot/cli-linux-x64-musl",
		dirName: "plot-cli-linux-x64-musl",
		bunTarget: "bun-linux-x64-musl",
		os: ["linux"],
		cpu: ["x64"],
		binName: "plot-ai",
	},
	{
		packageName: "@plot/cli-win32-x64-msvc",
		dirName: "plot-cli-win32-x64-msvc",
		bunTarget: "bun-windows-x64",
		os: ["win32"],
		cpu: ["x64"],
		binName: "plot-ai.exe",
	},
] as const;

export type ReleaseTarget = (typeof releaseTargets)[number];

export function readJson(path: string) {
	return JSON.parse(readFileSync(path, "utf8"));
}

export function getOptionalDependencies() {
	return Object.fromEntries(
		releaseTargets.map((target) => [target.packageName, version]),
	);
}
