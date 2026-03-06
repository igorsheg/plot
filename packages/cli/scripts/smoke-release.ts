#!/usr/bin/env bun

import { $ } from "bun";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoDir = fileURLToPath(new URL("../../..", import.meta.url));
const releaseDir = join(repoDir, "dist/release");
const umbrellaDir = join(releaseDir, "plot-ai");
const defaultPlatformDir = join(
	releaseDir,
	process.platform === "darwin"
		? "plot-cli-darwin-arm64"
		: "plot-cli-linux-x64-gnu",
);

const platformTarball =
	process.env["PLOT_SMOKE_PLATFORM_TGZ"] ?? findTarball(defaultPlatformDir);
const umbrellaTarball =
	process.env["PLOT_SMOKE_UMBRELLA_TGZ"] ?? findTarball(umbrellaDir);

if (!existsSync(platformTarball)) {
	throw new Error(`missing platform tarball: ${platformTarball}`);
}
if (!existsSync(umbrellaTarball)) {
	throw new Error(`missing umbrella tarball: ${umbrellaTarball}`);
}

const tempDir = mkdtempSync(join(tmpdir(), "plot-ai-smoke-"));

try {
	writeFileSync(
		join(tempDir, "package.json"),
		JSON.stringify(
			{ name: "plot-ai-smoke", private: true, type: "module" },
			null,
			2,
		),
	);

	await $`npm install ${platformTarball}`.cwd(tempDir);
	await $`PLOT_SKIP_POSTINSTALL_CHECK=1 npm install ${umbrellaTarball}`.cwd(
		tempDir,
	);
	await $`./node_modules/.bin/plot-ai --help`.cwd(tempDir);
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}

function findTarball(dir: string) {
	const file = readdirSync(dir).find((entry) => entry.endsWith(".tgz"));
	if (!file) throw new Error(`no tarball found in ${dir}`);
	return join(dir, file);
}
