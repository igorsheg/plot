#!/usr/bin/env bun

import { $ } from "bun";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = fileURLToPath(new URL("../../..", import.meta.url));
const releaseDir = join(repoDir, "dist/release");
const channel = process.env["PLOT_CHANNEL"] ?? "latest";
const dryRun =
	process.argv.includes("--dry-run") || process.env["PLOT_DRY_RUN"] === "1";
const provenance = !dryRun && process.env["CI"] === "true";

const entries = readdirSync(releaseDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

const platformPackages = entries.filter((entry) => entry !== "plot-ai");
platformPackages.sort();

await Promise.all(
	platformPackages.map((entry) =>
		publishPackage(join(releaseDir, entry), channel),
	),
);

await publishPackage(join(releaseDir, "plot-ai"), channel);

async function publishPackage(packageDir: string, tag: string) {
	const manifest = JSON.parse(
		readFileSync(join(packageDir, "package.json"), "utf8"),
	);
	const mode = dryRun ? "dry-run" : "publish";
	console.log(`${mode} ${manifest.name}@${manifest.version} (${tag})`);
	const args = ["publish", "--access", "public", "--tag", tag];
	if (dryRun) args.push("--dry-run");
	if (provenance) args.push("--provenance");
	await $`npm ${args}`.cwd(packageDir);
}
