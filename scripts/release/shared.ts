#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const repoDir = join(scriptDir, "../..");
export const releaseDir = join(repoDir, "dist/release");
export const plotPackageDir = join(repoDir, "packages/plot");
export const webDistDir = join(repoDir, "packages/web/dist");
export const piSkillsDir = join(repoDir, "packages/plot/resources/skills");

export const plotPackage = readJson(join(plotPackageDir, "package.json")) as {
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

export const version = process.env["PLOT_VERSION"] ?? plotPackage.version;
export const channel = process.env["PLOT_CHANNEL"] ?? "latest";
export const dryRun = process.argv.includes("--dry-run") || process.env["PLOT_DRY_RUN"] === "1";

export const releaseTargets = [
  {
    packageName: "@plot-ai/darwin-arm64",
    dirName: "plot-ai-darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    os: ["darwin"],
    cpu: ["arm64"],
    binName: "plot-ai",
    opentuiPlatformPackage: "@opentui/core-darwin-arm64",
  },
  {
    packageName: "@plot-ai/darwin-x64",
    dirName: "plot-ai-darwin-x64",
    bunTarget: "bun-darwin-x64",
    os: ["darwin"],
    cpu: ["x64"],
    binName: "plot-ai",
    opentuiPlatformPackage: "@opentui/core-darwin-x64",
  },
  {
    packageName: "@plot-ai/linux-arm64-gnu",
    dirName: "plot-ai-linux-arm64-gnu",
    bunTarget: "bun-linux-arm64",
    os: ["linux"],
    cpu: ["arm64"],
    binName: "plot-ai",
    opentuiPlatformPackage: "@opentui/core-linux-arm64",
  },
  {
    packageName: "@plot-ai/linux-x64-gnu",
    dirName: "plot-ai-linux-x64-gnu",
    bunTarget: "bun-linux-x64",
    os: ["linux"],
    cpu: ["x64"],
    binName: "plot-ai",
    opentuiPlatformPackage: "@opentui/core-linux-x64",
  },
  {
    packageName: "@plot-ai/linux-x64-musl",
    dirName: "plot-ai-linux-x64-musl",
    bunTarget: "bun-linux-x64-musl",
    os: ["linux"],
    cpu: ["x64"],
    binName: "plot-ai",
    opentuiPlatformPackage: "@opentui/core-linux-x64",
  },
  {
    packageName: "@plot-ai/win32-x64-msvc",
    dirName: "plot-ai-win32-x64-msvc",
    bunTarget: "bun-windows-x64",
    os: ["win32"],
    cpu: ["x64"],
    binName: "plot-ai.exe",
    opentuiPlatformPackage: "@opentui/core-win32-x64",
  },
] as const;

export type ReleaseTarget = (typeof releaseTargets)[number];

export function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function getOptionalDependencies() {
  return Object.fromEntries(releaseTargets.map((target) => [target.packageName, version]));
}
