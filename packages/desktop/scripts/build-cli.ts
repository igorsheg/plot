#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const desktopDir = resolve(import.meta.dirname, "..");
const repoDir = resolve(desktopDir, "../..");
const binDir = join(desktopDir, "bin");

mkdirSync(binDir, { recursive: true });

const result = await Bun.build({
	entrypoints: [join(repoDir, "packages/plot/src/cli/index.ts")],
	target: "bun",
	compile: {
		outfile: join(binDir, "plot-ai"),
	},
	tsconfig: join(repoDir, "packages/plot/tsconfig.json"),
});

if (!result.success) {
	console.error("Failed to compile plot-ai CLI:");
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

console.log(`Compiled plot-ai to ${join(binDir, "plot-ai")}`);
