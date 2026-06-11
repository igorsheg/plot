import { defineCommand } from "citty";
import { getCliIo } from "../cli-context.js";
import { extensionPrompt, plotDocs } from "../docs-content.js";

const docNames = [
	"index",
	"quickstart",
	"workflows",
	"extensions",
	"tui",
] as const;
type DocName = (typeof docNames)[number];

const isDocName = (value: string): value is DocName =>
	(docNames as readonly string[]).includes(value);

const docsIndex = `Plot docs\n\nStart here:\n  plot docs quickstart\n  plot docs workflows\n  plot docs extensions\n  plot docs tui\n\nFor LLM-assisted extension authoring:\n  plot docs extension-prompt\n`;

export const docsCommand = defineCommand({
	meta: {
		name: "docs",
		description: "Print Plot author docs",
	},
	args: {
		topic: {
			type: "positional",
			description: "index|quickstart|workflows|extensions|tui|extension-prompt",
			required: false,
		},
	},
	async run({ args }) {
		const io = getCliIo();
		const topic = typeof args.topic === "string" ? args.topic : undefined;
		if (topic === undefined) {
			await io.writeStdout(docsIndex);
			return;
		}
		if (topic === "extension-prompt") {
			await io.writeStdout(extensionPrompt);
			return;
		}
		if (isDocName(topic)) {
			await io.writeStdout(plotDocs[topic]);
			return;
		}
		await io.writeStdout(`${docsIndex}\nUnknown docs topic: ${topic}\n`);
	},
});
