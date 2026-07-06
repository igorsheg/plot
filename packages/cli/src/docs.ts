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
	`# Plot extension authoring prompt\n\nYou are helping write a Plot extension for a user.\n\nUse only the public SDK:\n\n\`\`\`ts\nimport { definePlotExtension, defineTool } from "plot-ai/sdk";\n\`\`\`\n\nDo not import Plot internals. Do not create custom TUI rendering. The extension discovers work, may register tools for integration side effects, may declare generic Operator Actions for controller input, and the workflow prompt teaches the Agent Run how to do the work.\n\nBelow is Plot's public extension authoring guide. Read it, then create the extension the user asks for.\n\n---\n\n${await readPlotDoc("extensions")}\n\n---\n\nUser goal:\n\n<replace this with what the extension should do>`;
