import { DEFAULT_WORKFLOW_PATH } from "@plot/session/workflow";
import type { ArgsDef } from "citty";

export const workflowArgs = {
	workflow: {
		type: "string",
		description: `Workflow file. Default: ${DEFAULT_WORKFLOW_PATH}`,
		valueHint: "path",
	},
	"session-id": {
		type: "string",
		description: "Stable Plot session id.",
		valueHint: "id",
	},
} satisfies ArgsDef;

export const pathArgs = {
	cwd: {
		type: "string",
		description: "Project root for workflow execution and Plot state.",
		valueHint: "path",
	},
	"plot-dir": {
		type: "string",
		description: "Project-local Plot state directory.",
		valueHint: "path",
	},
	"agent-dir": {
		type: "string",
		description: "Agent auth/model state directory.",
		valueHint: "path",
	},
	"session-dir": {
		type: "string",
		description: "Plot session storage directory.",
		valueHint: "path",
	},
} satisfies ArgsDef;

export const authPathArgs = {
	cwd: pathArgs.cwd,
	"plot-dir": pathArgs["plot-dir"],
	"agent-dir": pathArgs["agent-dir"],
} satisfies ArgsDef;

export const loggingArgs = {
	"log-level": {
		type: "string",
		description: "Log level: debug, info, warn, error.",
		valueHint: "level",
	},
} satisfies ArgsDef;

export const runtimeArgs = {
	"request-queue-capacity": {
		type: "string",
		description: "Maximum queued protocol/control requests.",
		valueHint: "count",
	},
	"event-capacity": {
		type: "string",
		description: "Maximum retained session events.",
		valueHint: "count",
	},
	"event-buffer-capacity": {
		type: "string",
		description: "Maximum buffered protocol event records.",
		valueHint: "count",
	},
	"tick-interval-ms": {
		type: "string",
		description: "Scheduled tick cadence in milliseconds.",
		valueHint: "ms",
	},
	"max-run-duration-ms": {
		type: "string",
		description: "Timeout for a single work run in milliseconds.",
		valueHint: "ms",
	},
	"trace-events": {
		type: "string",
		description: "Write debug session event trace JSONL to this path.",
		valueHint: "path",
	},
} satisfies ArgsDef;

export const agentOverrideArgs = {
	provider: {
		type: "string",
		description: "Override workflow agent provider.",
		valueHint: "id",
	},
	model: {
		type: "string",
		description: "Override workflow agent model.",
		valueHint: "id",
	},
	"api-key": {
		type: "string",
		description: "Provider API key override.",
		valueHint: "key",
	},
	thinking: {
		type: "string",
		description: "Thinking level when supported by the provider.",
		valueHint: "level",
	},
	tools: {
		type: "string",
		description: "Comma-separated allowlist of tools for the agent session.",
		valueHint: "list",
	},
	"exclude-tools": {
		type: "string",
		description: "Comma-separated tools to remove from the agent session.",
		valueHint: "list",
	},
	"no-tools": {
		type: "boolean",
		description: "Disable all agent tools.",
	},
	"no-builtin-tools": {
		type: "boolean",
		description: "Disable built-in agent tools.",
	},
	approve: {
		type: "boolean",
		description: "Approve supported provider/tool prompts automatically.",
	},
} satisfies ArgsDef;

export const resourceArgs = {
	skill: {
		type: "string",
		description: "Additional skill path for the agent session.",
		valueHint: "path",
	},
	"prompt-template": {
		type: "string",
		description: "Additional prompt template path.",
		valueHint: "path",
	},
	"no-skills": {
		type: "boolean",
		description: "Disable workflow-declared skills.",
	},
	"no-prompt-templates": {
		type: "boolean",
		description: "Disable workflow-declared prompt templates.",
	},
	"no-context-files": {
		type: "boolean",
		description: "Do not load context files into the agent session.",
	},
	"system-prompt": {
		type: "string",
		description: "Replace the agent system prompt.",
		valueHint: "text",
	},
	"append-system-prompt": {
		type: "string",
		description: "Append text to the agent system prompt.",
		valueHint: "text",
	},
} satisfies ArgsDef;

export const sessionCommandArgs = {
	...workflowArgs,
	...pathArgs,
	...loggingArgs,
	...runtimeArgs,
	...agentOverrideArgs,
	...resourceArgs,
} satisfies ArgsDef;
