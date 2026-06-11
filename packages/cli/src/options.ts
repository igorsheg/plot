import { makePlotAuth } from "@plot/session/pi-auth";
import { resolvePlotPaths } from "@plot/session/plot-paths";
import type { PlotAgentSessionCliOverrides } from "@plot/session/pi-agent-session";
import type { ParsedArgs } from "citty";
import type { LogFormat, LogLevelFlag } from "./runtime.js";

export const str = (args: ParsedArgs, name: string): string | undefined => {
	const v = args[name];
	return typeof v === "string" ? v : undefined;
};
export const bool = (args: ParsedArgs, name: string): boolean | undefined =>
	args[name] === true ? true : undefined;
export const int = (args: ParsedArgs, name: string): number | undefined => {
	const v = str(args, name);
	return v === undefined ? undefined : Number.parseInt(v, 10);
};
export const many = (args: ParsedArgs, name: string): readonly string[] => {
	const v = args[name];
	return Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
};
const splitCommaList = (value: string): readonly string[] =>
	value
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);

export const makeAuth = (options: {
	cwd: string;
	plotDir?: string;
	agentDir?: string;
}) =>
	makePlotAuth(
		resolvePlotPaths({
			cwd: options.cwd,
			...(options.plotDir === undefined ? {} : { plotDir: options.plotDir }),
			...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
		}),
	);

export const makeAgentSessionOverrides = (
	args: ParsedArgs,
): PlotAgentSessionCliOverrides | undefined => {
	const tools = str(args, "tools");
	const excludeTools = str(args, "exclude-tools");
	const override = {
		...(str(args, "provider") === undefined
			? {}
			: { provider: str(args, "provider")! }),
		...(str(args, "model") === undefined ? {} : { model: str(args, "model")! }),
		...(str(args, "api-key") === undefined
			? {}
			: { apiKey: str(args, "api-key")! }),
		...(str(args, "thinking") === undefined
			? {}
			: {
					thinking: str(
						args,
						"thinking",
					) as PlotAgentSessionCliOverrides["thinking"],
				}),
		...(tools === undefined ? {} : { tools: splitCommaList(tools) }),
		...(excludeTools === undefined
			? {}
			: { excludeTools: splitCommaList(excludeTools) }),
		...(bool(args, "no-tools") ? { noTools: true } : {}),
		...(bool(args, "no-builtin-tools") ? { noTools: "builtin" as const } : {}),
		...(bool(args, "approve") === undefined
			? {}
			: { allowProjectConfig: true }),
		...(many(args, "skill").length ? { skills: many(args, "skill") } : {}),
		...(many(args, "prompt-template").length
			? { prompts: many(args, "prompt-template") }
			: {}),
		...(bool(args, "no-skills") ? { noSkills: true } : {}),
		...(bool(args, "no-prompt-templates") ? { noPromptTemplates: true } : {}),
		...(bool(args, "no-context-files") ? { contextFiles: false } : {}),
		...(str(args, "system-prompt") === undefined
			? {}
			: { systemPrompt: str(args, "system-prompt")! }),
		...(many(args, "append-system-prompt").length
			? { appendSystemPrompt: many(args, "append-system-prompt") }
			: {}),
	} satisfies PlotAgentSessionCliOverrides;
	return Object.keys(override).length === 0 ? undefined : override;
};

export const baseOptions = (args: ParsedArgs) => {
	const overrides = makeAgentSessionOverrides(args);
	return {
		...(str(args, "workflow") === undefined
			? {}
			: { workflowPath: str(args, "workflow")! }),
		sessionId: str(args, "session-id") ?? "default",
		cwd: str(args, "cwd") ?? process.cwd(),
		...(str(args, "plot-dir") === undefined
			? {}
			: { plotDir: str(args, "plot-dir")! }),
		...(str(args, "agent-dir") === undefined
			? {}
			: { agentDir: str(args, "agent-dir")! }),
		...(str(args, "session-dir") === undefined
			? {}
			: { sessionDir: str(args, "session-dir")! }),
		logLevel: (str(args, "log-level") ?? "warn") as LogLevelFlag,
		logFormat: (str(args, "log-format") ?? "json") as LogFormat,
		...(int(args, "request-queue-capacity") === undefined
			? {}
			: { requestQueueCapacity: int(args, "request-queue-capacity")! }),
		...(int(args, "event-capacity") === undefined
			? {}
			: { eventCapacity: int(args, "event-capacity")! }),
		...(int(args, "replay-capacity") === undefined
			? {}
			: { replayCapacity: int(args, "replay-capacity")! }),
		...(int(args, "tick-interval-ms") === undefined
			? {}
			: { tickIntervalMs: int(args, "tick-interval-ms")! }),
		...(int(args, "max-run-duration-ms") === undefined
			? {}
			: { maxRunDurationMs: int(args, "max-run-duration-ms")! }),
		...(overrides === undefined ? {} : { agentSessionOverrides: overrides }),
	};
};
