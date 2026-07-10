import { randomUUID } from "node:crypto";
import { createSessionAuth } from "@plot/session/auth";
import type { AgentSessionOverrides } from "@plot/session/pi-session";
import type { ParsedArgs } from "citty";
import type { LogLevelFlag, RunInProcessOnceOptions } from "./runtime.js";

export const str = (
	args: Record<string, unknown>,
	name: string,
): string | undefined =>
	typeof args[name] === "string" ? (args[name] as string) : undefined;

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
	const value = str(args, name);
	return value === undefined ? undefined : Number.parseInt(value, 10);
};

export const many = (
	args: Record<string, unknown>,
	name: string,
): readonly string[] => {
	const value = args[name];
	return Array.isArray(value)
		? (value as string[])
		: typeof value === "string"
			? [value]
			: [];
};

const splitCommaList = (value: string | undefined) =>
	value
		?.split(",")
		.map((part) => part.trim())
		.filter(Boolean);

export const workflowPathFromArgs = (args: Record<string, unknown>) =>
	str(args, "workflow") ?? str(args, "workflowPath");

export const makeAuthFromArgs = (args: Record<string, unknown>) =>
	createSessionAuth({
		cwd: str(args, "cwd") ?? process.cwd(),
		plotDir: str(args, "plot-dir"),
		agentDir: str(args, "agent-dir"),
	} as Parameters<typeof createSessionAuth>[0]);

export const makeAgentSessionOverrides = (
	args: ParsedArgs,
): AgentSessionOverrides => {
	const skills = many(args, "skill");
	const prompts = many(args, "prompt-template");
	const appendSystemPrompt = many(args, "append-system-prompt");
	return {
		provider: str(args, "provider"),
		model: str(args, "model"),
		apiKey: str(args, "api-key"),
		thinking: str(args, "thinking") as AgentSessionOverrides["thinking"],
		tools: splitCommaList(str(args, "tools")),
		excludeTools: splitCommaList(str(args, "exclude-tools")),
		noTools: bool(args, "no-builtin-tools")
			? "builtin"
			: bool(args, "no-tools")
				? true
				: undefined,
		allowProjectConfig: bool(args, "allow-project-config"),
		skills: skills.length ? skills : undefined,
		prompts: prompts.length ? prompts : undefined,
		noSkills: bool(args, "no-skills"),
		noPromptTemplates: bool(args, "no-prompt-templates"),
		contextFiles: bool(args, "no-context-files") ? false : undefined,
		systemPrompt: str(args, "system-prompt"),
		appendSystemPrompt: appendSystemPrompt.length
			? appendSystemPrompt
			: undefined,
	} as AgentSessionOverrides;
};

export const defaultSessionId = (): string => `session-${randomUUID()}`;

export const baseOptions = (args: ParsedArgs): RunInProcessOnceOptions =>
	({
		sessionId: str(args, "session-id") ?? defaultSessionId(),
		cwd: str(args, "cwd") ?? process.cwd(),
		logLevel: (str(args, "log-level") ?? "warn") as LogLevelFlag,
		plotDir: str(args, "plot-dir"),
		agentDir: str(args, "agent-dir"),
		sessionDir: str(args, "session-dir"),
		requestQueueCapacity: int(args, "request-queue-capacity"),
		eventCapacity: int(args, "event-capacity"),
		eventBufferCapacity: int(args, "event-buffer-capacity"),
		tickIntervalMs: int(args, "tick-interval-ms"),
		maxRunDurationMs: int(args, "max-run-duration-ms"),
		workflowPath: workflowPathFromArgs(args),
		agentSessionOverrides: makeAgentSessionOverrides(args),
	}) as RunInProcessOnceOptions;
