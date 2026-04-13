#!/usr/bin/env bun

/**
 * Sync default workflow prompt bodies from packages/plot/examples/*.md
 * into typescript modules under src/bun/services/templates/.
 *
 * The .ts modules are bundled with electrobun. The source .md files in
 * packages/plot/examples/ remain the canonical reference.
 *
 * Run after editing examples/WORKFLOW.github.md or adding new tracker examples.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const desktopDir = resolve(import.meta.dirname, "..");
const repoDir = resolve(desktopDir, "../..");
const templatesDir = resolve(desktopDir, "src/bun/services/templates");

if (!existsSync(templatesDir)) mkdirSync(templatesDir, { recursive: true });

interface Template {
	exampleFile: string;
	outputFile: string;
	exportName: string;
}

const templates: Template[] = [
	{
		exampleFile: "packages/plot/examples/WORKFLOW.github.md",
		outputFile: "github-workflow-body.ts",
		exportName: "GITHUB_WORKFLOW_BODY",
	},
];

function extractBody(content: string): string {
	// Skip frontmatter (between first two --- lines)
	const lines = content.split("\n");
	let dashCount = 0;
	let bodyStart = 0;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === "---") {
			dashCount++;
			if (dashCount === 2) {
				bodyStart = i + 1;
				break;
			}
		}
	}
	return lines.slice(bodyStart).join("\n").trim();
}

for (const tpl of templates) {
	const sourcePath = resolve(repoDir, tpl.exampleFile);
	if (!existsSync(sourcePath)) {
		console.error(`source not found: ${sourcePath}`);
		process.exit(1);
	}

	const body = extractBody(readFileSync(sourcePath, "utf-8"));
	const outputPath = resolve(templatesDir, tpl.outputFile);

	const ts = `/**
 * Default prompt body for ${tpl.exportName.toLowerCase().replace(/_/g, " ")}.
 * Generated from ${tpl.exampleFile}.
 * Do NOT edit by hand — re-run \`bun run scripts/sync-templates.ts\`.
 */
export const ${tpl.exportName} = ${JSON.stringify(body)};
`;

	writeFileSync(outputPath, ts);
	console.log(`synced ${tpl.exampleFile} → ${tpl.outputFile} (${body.length} chars)`);
}
