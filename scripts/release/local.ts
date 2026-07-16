#!/usr/bin/env bun

import { $ } from "bun";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { packageTemplate, repoDir, releaseDir } from "./shared.js";

type Options = {
	force: boolean;
	outDir?: string;
	skipBunInstall: boolean;
	skipCheck: boolean;
	skipInstall: boolean;
	version: string;
	channel?: string;
};

const options = parseArgs();
const outDir = prepareOutputDirectory(options);
const artifactDir = join(outDir, "release");
const npmInstallDir = join(outDir, "npm-install");
const bunInstallDir = join(outDir, "bun-install");

try {
	if (!options.skipCheck) await $`bun run check`.cwd(repoDir);

	await $`bun run release:build`.cwd(repoDir).env({
		...process.env,
		PLOT_VERSION: options.version,
	});
	await $`bun run release:publish:dry-run`.cwd(repoDir).env({
		...process.env,
		PLOT_CHANNEL: options.channel ?? defaultChannel(options.version),
	});
	await $`cp -R ${releaseDir} ${artifactDir}`;

	if (!options.skipInstall) {
		await createIsolatedInstall("npm", npmInstallDir, artifactDir);
		if (!options.skipBunInstall) {
			await createIsolatedInstall("bun", bunInstallDir, artifactDir);
		}
	}

	console.log("\nLocal release artifacts created:");
	console.log(`  ${artifactDir}`);
	if (!options.skipInstall) {
		console.log("\nIsolated npm install:");
		console.log(`  ${npmInstallDir}`);
		console.log(`  ${join(npmInstallDir, "plot")} --help`);
		if (!options.skipBunInstall) {
			console.log("\nIsolated Bun install:");
			console.log(`  ${bunInstallDir}`);
			console.log(`  ${join(bunInstallDir, "plot")} --help`);
		}
	}
	console.log("\nRelease locally validated with:");
	console.log("  bun run check");
	console.log(`  PLOT_VERSION=${options.version} bun run release:build`);
	console.log(
		`  PLOT_CHANNEL=${options.channel ?? defaultChannel(options.version)} bun run release:publish:dry-run`,
	);
} catch (error) {
	if (!options.outDir) rmSync(outDir, { force: true, recursive: true });
	throw error;
}

async function createIsolatedInstall(
	manager: "npm" | "bun",
	installDir: string,
	artifactsDir: string,
) {
	mkdirSync(installDir, { recursive: true });
	const tarballs = findReleaseTarballs(artifactsDir);
	const dependencies = Object.fromEntries(
		tarballs.map((tarball) => [
			tarball.name,
			fileSpecifier(installDir, tarball.path),
		]),
	);
	writeFileSync(
		join(installDir, "package.json"),
		`${JSON.stringify({ private: true, dependencies, overrides: dependencies }, null, "\t")}\n`,
	);

	if (manager === "npm") {
		await $`npm install --omit=dev --ignore-scripts`.cwd(installDir);
	} else {
		await $`bun install --production --ignore-scripts`.cwd(installDir);
	}

	createPlotShim(installDir);
	const runPlot = (args: readonly string[]) => {
		const result = Bun.spawnSync({
			cmd: ["node", join(installDir, "plot"), ...args],
			cwd: installDir,
			env: { ...process.env, HOME: join(installDir, "home") },
			stdout: "pipe",
			stderr: "pipe",
		});
		return {
			exitCode: result.exitCode,
			stdout: result.stdout.toString(),
			stderr: result.stderr.toString(),
		};
	};
	const help = runPlot(["--help"]);
	if (!help.stdout.includes(`plot v${options.version}`))
		throw new Error(
			`${manager} install printed the wrong Plot version; expected ${options.version}`,
		);
	const printedVersion = runPlot(["--version"]);
	if (
		printedVersion.exitCode !== 0 ||
		printedVersion.stdout !== `${options.version}\n`
	)
		throw new Error(
			`${manager} install failed plot --version: ${printedVersion.stderr}`,
		);
	for (const [args, message] of [
		[["wat"], "Unknown command: wat"],
		[["docs", "wat"], "Unknown docs topic: wat"],
	] as const) {
		const result = runPlot(args);
		if (
			result.exitCode !== 2 ||
			result.stdout !== "" ||
			result.stderr !== `Error: ${message}\n`
		)
			throw new Error(
				`${manager} install violated CLI failure contract for ${args.join(" ")}`,
			);
	}
	const docs = runPlot(["docs", "quickstart"]);
	if (docs.exitCode !== 0) throw new Error(docs.stderr);
	await $`node --input-type=module -e ${"import { defineExtension } from 'plot-ai/sdk'; if (typeof defineExtension !== 'function') process.exit(1);"}`.cwd(
		installDir,
	);
	await $`node --input-type=module -e ${`import { createPlot } from "plot-ai";
import { defineExtension, defineWorkflow } from "plot-ai/sdk";
const extension = defineExtension({ id: "local-release", create: () => ({ discover: () => [] }) });
const workflow = defineWorkflow({ name: "local-release", agent: { provider: "anthropic", model: "claude-sonnet-4-6" }, extension: { use: extension }, prompt: "No work" });
const plot = await createPlot({ credentials: { anthropic: { type: "api-key", apiKey: "release-test" } } });
await plot.start(workflow);
await plot.dispose();`}`.cwd(installDir);
}

function findReleaseTarballs(artifactsDir: string) {
	const currentPlatformDir =
		process.platform === "darwin"
			? process.arch === "arm64"
				? "plot-ai-darwin-arm64"
				: "plot-ai-darwin-x64"
			: process.arch === "arm64"
				? "plot-ai-linux-arm64-gnu"
				: "plot-ai-linux-x64-gnu";
	return ["plot-ai", currentPlatformDir].map((dirName) => {
		const path = join(
			artifactsDir,
			dirName,
			`${dirName}-${options.version}.tgz`,
		);
		if (!existsSync(path)) {
			throw new Error(`missing release tarball: ${path}`);
		}
		return {
			name:
				dirName === "plot-ai"
					? "plot-ai"
					: `@plot-ai/${dirName.replace("plot-ai-", "")}`,
			path,
		};
	});
}

function createPlotShim(installDir: string) {
	const target = join("node_modules", "plot-ai", "bin", "plot");
	symlinkSync(target, join(installDir, "plot"));
}

function fileSpecifier(fromDirectory: string, file: string) {
	const relativePath = relative(fromDirectory, file).replaceAll("\\", "/");
	return `file:${relativePath.startsWith(".") ? relativePath : `./${relativePath}`}`;
}

function parseArgs(): Options {
	const options: Options = {
		force: false,
		skipBunInstall: false,
		skipCheck: false,
		skipInstall: false,
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
		if (arg === "--skip-bun-install") {
			options.skipBunInstall = true;
			continue;
		}
		if (arg === "--skip-check") {
			options.skipCheck = true;
			continue;
		}
		if (arg === "--skip-install") {
			options.skipInstall = true;
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

Builds and dry-run publishes Plot release packages, then installs the current
platform package and umbrella package into isolated npm/Bun projects outside the
repository for local release testing.

Options:
  --version <x.y.z>    Version to build. A leading v is accepted.
  --channel <tag>      npm dist-tag. Defaults to latest, or beta for prereleases.
  --out <dir>          Output directory. Defaults to a temp directory.
  --force              Remove --out first if it already exists.
  --skip-check         Do not run bun run check before building.
  --skip-install       Only create tarballs; do not create isolated installs.
  --skip-bun-install   Do not create the isolated Bun install.
  --help               Show this help.
`);
}
