import { randomUUID } from "node:crypto";
import type { Mutable } from "@plot/common/primitives";
import type { AgentSessionOverrides } from "@plot/session/pi-session";
import { createSessionAuth } from "@plot/session/auth";
import type { ParsedArgs } from "citty";
import type { LogLevelFlag, RunInProcessOnceOptions } from "./runtime.js";

export const str = (
	args: Record<string, unknown>,
	name: string,
): string | undefined => {
	const v = args[name];
	return typeof v === "string" ? v : undefined;
};
export const bool = (
	args: Record<string, unknown>,
	name: string,
): boolean | undefined => {
	const value = args[name];
	return value === true || value === "" || value === "true" ? true : undefined;
};
export const int = (
	args: Record<string, unknown>,
	name: string,
): number | undefined => {
	const v = str(args, name);
	return v === undefined ? undefined : Number.parseInt(v, 10);
};
export const many = (
	args: Record<string, unknown>,
	name: string,
): readonly string[] => {
	const v = args[name];
	return Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
};
const splitCommaList = (value: string): readonly string[] =>
	value
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);

export const workflowPathFromArgs = (args: Record<string, unknown>) =>
	str(args, "workflow") ?? str(args, "workflowPath");

export const makeAuthFromArgs = (args: Record<string, unknown>) => {
	const cwd = str(args, "cwd") ?? process.cwd();
	const plotDir = str(args, "plot-dir");
	const agentDir = str(args, "agent-dir");
	const options: Mutable<Parameters<typeof createSessionAuth>[0]> = { cwd };
	if (plotDir !== undefined) options.plotDir = plotDir;
	if (agentDir !== undefined) options.agentDir = agentDir;
	return createSessionAuth(options);
};

export const makeAgentSessionOverrides = (
	args: ParsedArgs,
): AgentSessionOverrides | undefined => {
	const override: Mutable<AgentSessionOverrides> = {};
	const provider = str(args, "provider");
	const model = str(args, "model");
	const apiKey = str(args, "api-key");
	const thinking = str(args, "thinking") as AgentSessionOverrides["thinking"];
	const tools = str(args, "tools");
	const excludeTools = str(args, "exclude-tools");
	const skills = many(args, "skill");
	const prompts = many(args, "prompt-template");
	const appendSystemPrompt = many(args, "append-system-prompt");
	const systemPrompt = str(args, "system-prompt");

	if (provider !== undefined) override.provider = provider;
	if (model !== undefined) override.model = model;
	if (apiKey !== undefined) override.apiKey = apiKey;
	if (thinking !== undefined) override.thinking = thinking;
	if (tools !== undefined) override.tools = splitCommaList(tools);
	if (excludeTools !== undefined)
		override.excludeTools = splitCommaList(excludeTools);
	if (bool(args, "no-tools")) override.noTools = true;
	if (bool(args, "no-builtin-tools")) override.noTools = "builtin";
	if (bool(args, "allow-project-config")) override.allowProjectConfig = true;
	if (skills.length > 0) override.skills = skills;
	if (prompts.length > 0) override.prompts = prompts;
	if (bool(args, "no-skills")) override.noSkills = true;
	if (bool(args, "no-prompt-templates")) override.noPromptTemplates = true;
	if (bool(args, "no-context-files")) override.contextFiles = false;
	if (systemPrompt !== undefined) override.systemPrompt = systemPrompt;
	if (appendSystemPrompt.length > 0)
		override.appendSystemPrompt = appendSystemPrompt;

	return Object.keys(override).length === 0 ? undefined : override;
};

export const defaultSessionId = (): string => `session-${randomUUID()}`;

export const baseOptions = (args: ParsedArgs) => {
	const overrides = makeAgentSessionOverrides(args);
	const cwd = str(args, "cwd") ?? process.cwd();
	const workflowPath = workflowPathFromArgs(args);
	const sessionId = str(args, "session-id") ?? defaultSessionId();
	const plotDir = str(args, "plot-dir");
	const agentDir = str(args, "agent-dir");
	const sessionDir = str(args, "session-dir");
	const requestQueueCapacity = int(args, "request-queue-capacity");
	const eventCapacity = int(args, "event-capacity");
	const eventBufferCapacity = int(args, "event-buffer-capacity");
	const tickIntervalMs = int(args, "tick-interval-ms");
	const maxRunDurationMs = int(args, "max-run-duration-ms");
	const options: Mutable<RunInProcessOnceOptions> = {
		sessionId,
		cwd,
		logLevel: (str(args, "log-level") ?? "warn") as LogLevelFlag,
	};
	if (plotDir !== undefined) options.plotDir = plotDir;
	if (agentDir !== undefined) options.agentDir = agentDir;
	if (sessionDir !== undefined) options.sessionDir = sessionDir;
	if (requestQueueCapacity !== undefined)
		options.requestQueueCapacity = requestQueueCapacity;
	if (eventCapacity !== undefined) options.eventCapacity = eventCapacity;
	if (eventBufferCapacity !== undefined)
		options.eventBufferCapacity = eventBufferCapacity;
	if (tickIntervalMs !== undefined) options.tickIntervalMs = tickIntervalMs;
	if (maxRunDurationMs !== undefined)
		options.maxRunDurationMs = maxRunDurationMs;
	if (workflowPath !== undefined) options.workflowPath = workflowPath;
	if (overrides !== undefined) options.agentSessionOverrides = overrides;
	return options;
};
