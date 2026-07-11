import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDocsDirs } from "./package.js";

const docNames = [
	"index",
	"quickstart",
	"workflows",
	"extensions",
	"tui",
	"web",
	"cli",
] as const;
export type DocName = (typeof docNames)[number];

export const isDocName = (value: string): value is DocName =>
	(docNames as readonly string[]).includes(value);

export const readPlotDoc = async (name: DocName): Promise<string> => {
	const file = `${name}.md`;
	for (const dir of getDocsDirs()) {
		try {
			// eslint-disable-next-line no-await-in-loop -- docs lookup checks fallback directories in order.
			return await readFile(join(dir, file), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	throw new Error(`Plot docs file not found: ${file}`);
};

export const readExtensionPrompt = async (): Promise<string> =>
	`# Build a Plot extension\n\nCreate a production-quality Plot Workflow and extension for the user goal below.\n\nRules:\n\n1. Import only from the public SDK:\n\n\`\`\`ts\nimport { definePlotExtension, defineTool } from "plot-ai/sdk";\n\`\`\`\n\n2. Return complete, runnable files with no ellipses or invented APIs.\n3. Keep discovery observational and authoritative. Return an empty list only when work is truly gone; throw on observation failure.\n4. Use stable domain ids and revision-based versions. Make mutation tools idempotent and bind them to the selected Work Item.\n5. Put facts and safe integration operations in TypeScript. Put investigation strategy and quality criteria in the Workflow prompt.\n6. Do not import Plot internals, create custom Plot UI, launch nested Agent Sessions, or implement another scheduler.\n7. Include boundary validation, focused tests for integration logic, and exact commands for \`plot doctor\` and a local run.\n\nRead the complete public contract below before writing code.\n\n---\n\n${await readPlotDoc("extensions")}\n\n---\n\n## User goal\n\n<replace this with what the extension should do>`;
