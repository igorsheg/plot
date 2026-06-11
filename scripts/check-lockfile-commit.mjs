#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
	encoding: "utf8",
})
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean);

const packageChanged = staged.some((file) => file.endsWith("package.json"));
const lockChanged = staged.includes("bun.lock");

if (packageChanged && !lockChanged) {
	console.error("package.json changed but bun.lock is not staged");
	console.error(
		"Run `bun install` and stage bun.lock, or stage bun.lock if already updated.",
	);
	process.exit(1);
}
