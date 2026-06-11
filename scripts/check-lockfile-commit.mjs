#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const staged = git(["diff", "--cached", "--name-only"])
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean);

const packageFiles = staged.filter((file) => file.endsWith("package.json"));
const lockChanged = staged.includes("bun.lock");

const packageDependencyChanged = packageFiles.some((file) =>
	dependencyShapeChanged(file),
);

if (packageDependencyChanged && !lockChanged) {
	console.error("package.json dependencies changed but bun.lock is not staged");
	console.error(
		"Run `bun install` and stage bun.lock, or stage bun.lock if already updated.",
	);
	process.exit(1);
}

function dependencyShapeChanged(file) {
	const before = readGitJson(["show", `HEAD:${file}`]);
	const after = readGitJson(["show", `:${file}`]);
	return (
		JSON.stringify(dependencyShape(before)) !==
		JSON.stringify(dependencyShape(after))
	);
}

function dependencyShape(manifest) {
	if (!manifest) return null;
	return {
		dependencies: manifest.dependencies ?? {},
		devDependencies: manifest.devDependencies ?? {},
		optionalDependencies: manifest.optionalDependencies ?? {},
		peerDependencies: manifest.peerDependencies ?? {},
		resolutions: manifest.resolutions ?? {},
		overrides: manifest.overrides ?? {},
		workspaces: manifest.workspaces ?? {},
		packageManager: manifest.packageManager ?? null,
	};
}

function readGitJson(args) {
	try {
		return JSON.parse(git(args));
	} catch {
		return null;
	}
}

function git(args) {
	return execFileSync("git", args, { encoding: "utf8" });
}
