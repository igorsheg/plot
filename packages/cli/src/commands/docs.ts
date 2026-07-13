import { defineCommand } from "citty";
import { getCliIo } from "../cli-context.js";
import {
	isDocName,
	readPlotDoc,
	readSdkReference,
	renderDocsPaths,
} from "../docs.js";

const docsIndex = `Plot docs

Start here:
  plot docs quickstart
  plot docs workflows
  plot docs extensions
  plot docs tui
  plot docs web
  plot docs cli

For coding agents building an extension:
  plot docs guide      authoring brief
  plot docs sdk        typed extension contract (sdk.d.ts)
  plot docs --paths    on-disk locations of docs, examples, and sdk
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
				"index|quickstart|guide|workflows|extensions|sdk|tui|web|cli",
			required: false,
		},
		paths: {
			type: "boolean",
			description:
				"Print on-disk locations of shipped docs, examples, and SDK declarations",
			default: false,
		},
	},
	async run({ args }) {
		const io = getCliIo();
		if (args.paths === true) {
			await io.writeStdout(renderDocsPaths());
			return;
		}
		const requested = typeof args.topic === "string" ? args.topic : undefined;
		if (requested === undefined) {
			await io.writeStdout(await readPlotDoc("index"));
			return;
		}
		const topic = requested;
		if (topic === "sdk") {
			await io.writeStdout(await readSdkReference());
			return;
		}
		if (isDocName(topic)) {
			await io.writeStdout(await readPlotDoc(topic));
			return;
		}
		await io.writeStdout(`${docsIndex}\nUnknown docs topic: ${topic}\n`);
	},
});
