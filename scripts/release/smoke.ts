#!/usr/bin/env bun

import { $ } from "bun";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseDir } from "./shared.js";

const umbrellaDir = join(releaseDir, "plot-ai");
const defaultPlatformDir = join(
	releaseDir,
	process.platform === "darwin"
		? process.arch === "arm64"
			? "plot-ai-darwin-arm64"
			: "plot-ai-darwin-x64"
		: process.arch === "arm64"
			? "plot-ai-linux-arm64-gnu"
			: "plot-ai-linux-x64-gnu",
);

const platformTarball =
	process.env["PLOT_SMOKE_PLATFORM_TGZ"] ?? findTarball(defaultPlatformDir);
const umbrellaTarball =
	process.env["PLOT_SMOKE_UMBRELLA_TGZ"] ?? findTarball(umbrellaDir);

if (!existsSync(platformTarball))
	throw new Error(`missing platform tarball: ${platformTarball}`);
if (!existsSync(umbrellaTarball))
	throw new Error(`missing umbrella tarball: ${umbrellaTarball}`);

const tempDir = mkdtempSync(join(tmpdir(), "plot-smoke-"));

try {
	writeFileSync(
		join(tempDir, "package.json"),
		JSON.stringify(
			{ name: "plot-smoke", private: true, type: "module" },
			null,
			2,
		),
	);

	await $`npm install ${platformTarball}`.cwd(tempDir);
	await $`npm install ${umbrellaTarball}`.cwd(tempDir);

	if (!existsSync(join(tempDir, "node_modules", ".bin", "plot"))) {
		throw new Error("missing plot bin after install");
	}

	if (
		existsSync(
			join(tempDir, "node_modules", "plot-ai", "examples", "debug", ".plot"),
		)
	)
		throw new Error("release includes example runtime state");
	if (
		existsSync(
			join(tempDir, "node_modules", "plot-ai", "docs", "nuclear-refactor.md"),
		)
	)
		throw new Error("release includes the internal implementation plan");

	const manifest = (await Bun.file(
		join(tempDir, "node_modules", "plot-ai", "package.json"),
	).json()) as { readonly version?: string };
	const version = manifest.version;
	if (version === undefined) throw new Error("plot-ai package has no version");
	const help = await $`./node_modules/.bin/plot --help`.cwd(tempDir).quiet();
	const helpText = help.stdout.toString();
	if (!helpText.includes(`plot v${version}`)) {
		throw new Error(
			`plot --help printed the wrong version; expected ${version}`,
		);
	}
	await $`./node_modules/.bin/plot docs quickstart`.cwd(tempDir);
	await $`node --input-type=module -e ${"import { definePlotExtension } from 'plot-ai/sdk'; if (typeof definePlotExtension !== 'function') process.exit(1);"}`.cwd(
		tempDir,
	);
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}

function findTarball(dir: string) {
	const file = readdirSync(dir).find((entry) => entry.endsWith(".tgz"));
	if (!file) throw new Error(`no tarball found in ${dir}`);
	return join(dir, file);
}
