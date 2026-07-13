import type { ArgsDef } from "citty";

export const workflowPathArg = {
	workflowPath: {
		type: "positional",
		description: "Workflow file. Default: WORKFLOW.md.",
		required: false,
	},
} satisfies ArgsDef;
