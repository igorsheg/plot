#!/usr/bin/env bun
// Extracts every ```ts fence from docs/*.md and typechecks it against the
// real SDK, so documentation code cannot drift from the contract it teaches.

import { $ } from "bun";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = resolve(fileURLToPath(import.meta.url), "../..");
const docsDir = join(repoDir, "docs");
const snippetsDir = join(repoDir, "node_modules", ".cache", "docs-snippets");

rmSync(snippetsDir, { recursive: true, force: true });
mkdirSync(snippetsDir, { recursive: true });

const fencePattern = /^```ts\n([\s\S]*?)^```$/gm;
let snippetCount = 0;

for (const file of readdirSync(docsDir).filter((name) =>
	name.endsWith(".md"),
)) {
	const markdown = readFileSync(join(docsDir, file), "utf8");
	let index = 0;
	for (const match of markdown.matchAll(fencePattern)) {
		index += 1;
		const line = markdown.slice(0, match.index).split("\n").length + 1;
		const name = `${file.replace(/\.md$/, "")}-${index}.ts`;
		writeFileSync(join(snippetsDir, name), `// ${file}:${line}\n${match[1]}`);
		snippetCount += 1;
	}
}

if (snippetCount === 0) {
	console.error("no ```ts snippets found under docs/ — extractor broken?");
	process.exit(1);
}

writeFileSync(
	join(snippetsDir, "tsconfig.json"),
	`${JSON.stringify(
		{
			extends: join(repoDir, "packages/@repo/base.json"),
			compilerOptions: {
				noEmit: true,
				// Snippets teach one idea each; unused declarations are fine.
				noUnusedLocals: false,
				noUnusedParameters: false,
				paths: {
					"plot-ai": [join(repoDir, "packages/runtime/src/index.ts")],
					"plot-ai/sdk": [join(repoDir, "packages/sdk/src/sdk.ts")],
				},
			},
			include: ["*.ts"],
		},
		null,
		"\t",
	)}\n`,
);

const result = await $`bun x tsc -p ${snippetsDir}`.cwd(repoDir).nothrow();
if (result.exitCode !== 0) {
	console.error(result.stdout.toString() + result.stderr.toString());
	console.error(
		`docs snippet typecheck failed — each snippet's header comment names its source file and line.`,
	);
	process.exit(1);
}
console.log(`docs snippets OK (${snippetCount} checked)`);
