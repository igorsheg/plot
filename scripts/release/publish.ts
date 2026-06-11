#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { channel, dryRun, releaseDir, releaseTargets } from "./shared.js";

const provenance = !dryRun && process.env["CI"] === "true";

const packages = [
	...releaseTargets.map((target) => ({
		dirName: target.dirName,
		name: target.packageName,
	})),
	{ dirName: "plot-ai", name: "plot-ai" },
] as const;

const manifests = await Promise.all(
	packages.map(async (pkg) => {
		const packageDir = join(releaseDir, pkg.dirName);
		if (!existsSync(packageDir)) {
			throw new Error(`missing release package directory: ${packageDir}`);
		}

		const manifest = await Bun.file(join(packageDir, "package.json")).json();
		if (manifest.name !== pkg.name) {
			throw new Error(
				`${pkg.dirName}/package.json has name ${manifest.name}, expected ${pkg.name}`,
			);
		}

		return { ...pkg, packageDir, version: String(manifest.version) };
	}),
);

const versions = new Set(manifests.map((manifest) => manifest.version));
if (versions.size !== 1) {
	throw new Error(
		`release packages are not lockstep versioned: ${[...versions].join(", ")}`,
	);
}

console.log(
	`${dryRun ? "Dry-run publishing" : "Publishing"} Plot packages at ${manifests[0]?.version} (${channel})\n`,
);

for (const manifest of manifests) {
	await publishPackage(manifest);
}

async function isAlreadyPublished(
	packageName: string,
	version: string,
): Promise<boolean> {
	const result = await Bun.$`npm view ${packageName}@${version} version --json`
		.quiet()
		.nothrow();

	if (result.exitCode === 0 && result.stdout.toString().trim()) return true;

	const output = `${result.stdout}\n${result.stderr}`;
	if (output.includes("E404") || output.includes("404 Not Found")) return false;

	throw new Error(
		output.trim()
			? `failed to query ${packageName}@${version}\n${output}`
			: `failed to query ${packageName}@${version}`,
	);
}

async function validatePack(packageDir: string) {
	const result = await $`npm pack --dry-run --ignore-scripts --json`
		.cwd(packageDir)
		.quiet();
	const packed = JSON.parse(result.stdout.toString())[0];
	console.log(
		`  ${packed.filename}: ${packed.files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked`,
	);
}

async function publishPackage(manifest: (typeof manifests)[number]) {
	const published = await isAlreadyPublished(manifest.name, manifest.version);

	if (dryRun) {
		console.log(
			published
				? `${manifest.name}@${manifest.version} is already published; validating package contents only.`
				: `${manifest.name}@${manifest.version} is not published; validating package contents before publish.`,
		);
		await validatePack(manifest.packageDir);
		console.log();
		return;
	}

	if (published) {
		console.log(
			`skip ${manifest.name}@${manifest.version} — already published\n`,
		);
		return;
	}

	console.log(`publish ${manifest.name}@${manifest.version} (${channel})`);

	const args = [
		"publish",
		"--access",
		"public",
		"--tag",
		channel,
		"--ignore-scripts",
	];
	if (provenance) args.push("--provenance");

	await $`npm ${args}`.cwd(manifest.packageDir);
	console.log();
}
