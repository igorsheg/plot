import { defineCommand } from "citty";
import { getCliIo } from "../cli-context.js";
import { isDocName, readExtensionPrompt, readPlotDoc } from "../docs.js";

const docsIndex = `Plot docs

Start here:
  plot docs quickstart
  plot docs workflows
  plot docs extensions
  plot docs tui
  plot docs web
  plot docs cli

For LLM-assisted extension authoring:
  plot docs extension-prompt
`;

export const docsCommand = defineCommand({
	meta: {
		name: "docs",
		description: "Print Plot author docs",
	},
	args: {
		topic: {
			type: "positional",
			description:
				"index|quickstart|workflows|extensions|tui|web|cli|extension-prompt",
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
			await io.writeStdout(await readExtensionPrompt());
			return;
		}
		if (isDocName(topic)) {
			await io.writeStdout(await readPlotDoc(topic));
			return;
		}
		await io.writeStdout(`${docsIndex}\nUnknown docs topic: ${topic}\n`);
	},
});
