import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineCommand } from "citty";
import { DEFAULT_WORKFLOW_PATH } from "@plot/session/workflow";
import { pathArgs, workflowPathArg } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { bool, str, workflowPathFromArgs } from "../options.js";

const workflowTemplate = `---
name: default
---
Review this project and identify useful follow-up work.
`;

export const initCommand = defineCommand({
	meta: {
		name: "init",
		description: "Create a starter Plot workflow.",
	},
	args: {
		...workflowPathArg,
		cwd: pathArgs.cwd,
		force: {
			type: "boolean",
			description: "Overwrite an existing workflow file.",
		},
	},
	run: async ({ args }) => {
		const cwd = str(args, "cwd") ?? process.cwd();
		const workflowPath = resolve(
			cwd,
			workflowPathFromArgs(args) ?? DEFAULT_WORKFLOW_PATH,
		);
		await mkdir(dirname(workflowPath), { recursive: true });
		try {
			await writeFile(workflowPath, workflowTemplate, {
				flag: bool(args, "force") ? "w" : "wx",
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST")
				throw new Error(
					`${workflowPath} already exists. Pass --force to overwrite.`,
					{
						cause: error,
					},
				);
			throw error;
		}
		await getCliIo().writeStdout(`Created ${workflowPath}\n`);
	},
});
