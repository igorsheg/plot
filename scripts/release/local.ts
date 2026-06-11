#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { packageTemplate, repoDir } from "./shared.js";

type Options = {
	force: boolean;
	outDir?: string;
	skipCheck: boolean;
	version: string;
	channel?: string;
};

const options = parseArgs();
const outDir = prepareOutputDirectory(options);
const releaseDir = join(repoDir, "dist/release");

try {
	if (!options.skipCheck) await $`bun run check`.cwd(repoDir);

	await $`bun run release:build`.cwd(repoDir).env({
		...process.env,
		PLOT_VERSION: options.version,
	});
	await $`bun run release:smoke`.cwd(repoDir);
	await $`bun run release:publish:dry-run`.cwd(repoDir).env({
		...process.env,
		PLOT_CHANNEL: options.channel ?? defaultChannel(options.version),
	});
	await $`cp -R ${releaseDir} ${outDir}`;

	console.log("\nLocal release artifacts created:");
	console.log(`  ${join(outDir, "release")}`);
	console.log("\nRelease locally validated with:");
	console.log("  bun run check");
	console.log(`  PLOT_VERSION=${options.version} bun run release:build`);
	console.log("  bun run release:smoke");
	console.log(
		`  PLOT_CHANNEL=${options.channel ?? defaultChannel(options.version)} bun run release:publish:dry-run`,
	);
} catch (error) {
	if (!options.outDir) rmSync(outDir, { force: true, recursive: true });
	throw error;
}

function parseArgs(): Options {
	const options: Options = {
		force: false,
		skipCheck: false,
		version: packageTemplate.version,
	};
	const args = process.argv.slice(2);

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--help") {
			printUsage();
			process.exit(0);
		}
		if (arg === "--force") {
			options.force = true;
			continue;
		}
		if (arg === "--skip-check") {
			options.skipCheck = true;
			continue;
		}
		if (arg === "--version") {
			options.version = requireValue(args, ++index, "--version").replace(
				/^v/,
				"",
			);
			continue;
		}
		if (arg === "--channel") {
			options.channel = requireValue(args, ++index, "--channel");
			continue;
		}
		if (arg === "--out") {
			options.outDir = requireValue(args, ++index, "--out");
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}

	return options;
}

function requireValue(args: string[], index: number, flag: string) {
	const value = args[index];
	if (!value) throw new Error(`${flag} requires a value`);
	return value;
}

function prepareOutputDirectory(options: Options) {
	if (!options.outDir)
		return mkdtempSync(join(tmpdir(), "plot-local-release-"));

	const outDir = resolve(options.outDir);
	if (isInsidePath(outDir, repoDir)) {
		throw new Error(
			`Output directory must be outside the repository: ${outDir}`,
		);
	}
	if (existsSync(outDir)) {
		if (!options.force) {
			throw new Error(
				`Output directory already exists. Use --force: ${outDir}`,
			);
		}
		rmSync(outDir, { force: true, recursive: true });
	}
	mkdirSync(outDir, { recursive: true });
	return outDir;
}

function isInsidePath(child: string, parent: string) {
	const relativePath = relative(parent, child);
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function defaultChannel(version: string) {
	return version.includes("-") ? "beta" : "latest";
}

function printUsage() {
	console.log(`Usage: bun run release:local --version <x.y.z> [options]

Builds, smokes, and dry-run publishes Plot release packages, then copies the
release bundle to an isolated directory outside the repository.

Options:
  --version <x.y.z>    Version to build. A leading v is accepted.
  --channel <tag>      npm dist-tag. Defaults to latest, or beta for prereleases.
  --out <dir>          Output directory. Defaults to a temp directory.
  --force              Remove --out first if it already exists.
  --skip-check         Do not run bun run check before building.
  --help               Show this help.
`);
}
