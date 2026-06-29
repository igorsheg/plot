import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { AgentSessionOverrides } from "@plot/session/agent-session";
import { createSessionAuth } from "@plot/session/auth";
import type { ParsedArgs } from "citty";
import type { LogLevelFlag } from "./runtime.js";

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
export const int = (args: ParsedArgs, name: string): number | undefined => {
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

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export const makeAuth = (options: {
	cwd: string;
	plotDir?: string;
	agentDir?: string;
}) => createSessionAuth(options);

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
	if (bool(args, "approve") !== undefined) override.allowProjectConfig = true;
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

export const defaultSessionId = (input: {
	readonly cwd: string;
	readonly workflowPath?: string;
}): string => {
	const workflowPath = input.workflowPath ?? "WORKFLOW.md";
	const fingerprint = createHash("sha256")
		.update(`${resolve(input.cwd)}\0${resolve(input.cwd, workflowPath)}`)
		.digest("hex")
		.slice(0, 12);
	return `project-${fingerprint}`;
};

export const baseOptions = (args: ParsedArgs) => {
	const overrides = makeAgentSessionOverrides(args);
	const cwd = str(args, "cwd") ?? process.cwd();
	const workflowPath = str(args, "workflow");
	const sessionId =
		str(args, "session-id") ??
		defaultSessionId({
			cwd,
			...(workflowPath === undefined ? {} : { workflowPath }),
		});
	const options = {
		sessionId,
		cwd,
		logLevel: (str(args, "log-level") ?? "warn") as LogLevelFlag,
	};
	if (workflowPath !== undefined) Object.assign(options, { workflowPath });
	for (const [key, option] of [
		["plot-dir", "plotDir"],
		["agent-dir", "agentDir"],
		["session-dir", "sessionDir"],
	] as const) {
		const value = str(args, key);
		if (value !== undefined) Object.assign(options, { [option]: value });
	}
	for (const [key, option] of [
		["request-queue-capacity", "requestQueueCapacity"],
		["event-capacity", "eventCapacity"],
		["event-buffer-capacity", "eventBufferCapacity"],
		["tick-interval-ms", "tickIntervalMs"],
		["max-run-duration-ms", "maxRunDurationMs"],
	] as const) {
		const value = int(args, key);
		if (value !== undefined) Object.assign(options, { [option]: value });
	}
	if (overrides !== undefined)
		Object.assign(options, { agentSessionOverrides: overrides });
	return options;
};
