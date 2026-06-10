import { createInterface } from "node:readline/promises";
import { Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	runOnce,
	serveStdio,
	type LogFormat,
	type LogLevelFlag,
} from "./runtime.js";
import { DEFAULT_WORKFLOW_PATH } from "@plot/session/workflow";
import {
	makePlotAuth,
	type PlotAuthStatusInfo,
	type PlotModelInfo,
} from "@plot/session/pi-auth";
import { resolvePlotPaths } from "@plot/session/plot-paths";
import type { CreateAgentSession } from "@plot/session/agent-session-types";
import type { PlotSessionEvent } from "@plot/session/plot-session";
import type { PlotAgentSessionCliOverrides } from "@plot/session/pi-agent-session";
import type { StdioChunk } from "@plot/session/protocol-stdio";

export const version = "0.0.0";

export interface PlotCliIo {
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (text: string) => Effect.Effect<void, unknown>;
	readonly writeStderr?: (text: string) => Effect.Effect<void, unknown>;
	readonly createAgentSession?: CreateAgentSession;
}

class PlotCliIoError extends Schema.TaggedErrorClass<PlotCliIoError>()(
	"PlotCliIoError",
	{ message: Schema.String },
) {}

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const writeProcessStdout = (line: string) =>
	Effect.tryPromise({
		try: () =>
			new Promise<void>((resolve, reject) => {
				process.stdout.write(line, (error?: Error | null) => {
					if (error) reject(error);
					else resolve();
				});
			}),
		catch: (error) => new PlotCliIoError({ message: errorMessage(error) }),
	});

export const processCliIo = (): PlotCliIo => ({
	stdin: process.stdin as AsyncIterable<StdioChunk>,
	writeStdout: writeProcessStdout,
	writeStderr: writeProcessStderr,
});

const writeProcessStderr = (text: string) =>
	Effect.tryPromise({
		try: () =>
			new Promise<void>((resolve, reject) => {
				process.stderr.write(text, (error?: Error | null) => {
					if (error) reject(error);
					else resolve();
				});
			}),
		catch: (error) => new PlotCliIoError({ message: errorMessage(error) }),
	});

const writeCliStderr = (io: PlotCliIo, text: string) =>
	(io.writeStderr ?? writeProcessStderr)(text);

const runHumanCommand = <A>(
	io: PlotCliIo,
	effect: Effect.Effect<A, unknown>,
	render: (value: A) => string,
	fix: string,
) =>
	effect.pipe(
		Effect.flatMap((value) => io.writeStdout(render(value))),
		Effect.catch((error) =>
			writeCliStderr(io, `Error: ${errorMessage(error)}\nFix: ${fix}\n`).pipe(
				Effect.andThen(Effect.fail(error)),
			),
		),
	);

const authPromise = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({
		try: run,
		catch: (error) => new PlotCliIoError({ message: errorMessage(error) }),
	});

const formatTokenCount = (count: number): string => {
	if (count >= 1_000_000) {
		const millions = count / 1_000_000;
		return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
	}
	if (count >= 1_000) {
		const thousands = count / 1_000;
		return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
	}
	return count.toString();
};

const renderTable = (
	rows: readonly Record<string, string>[],
	headers: readonly string[],
) => {
	const widths = Object.fromEntries(
		headers.map((header) => [
			header,
			Math.max(header.length, ...rows.map((row) => row[header]?.length ?? 0)),
		]),
	);
	return [
		headers.map((header) => header.padEnd(widths[header] ?? 0)).join("  "),
		...rows.map((row) =>
			headers
				.map((header) => (row[header] ?? "").padEnd(widths[header] ?? 0))
				.join("  "),
		),
	].join("\n");
};

const renderModels = (
	search: string | undefined,
	models: readonly PlotModelInfo[],
) => {
	if (models.length === 0) {
		return search === undefined
			? "No models available. Configure provider auth and try again.\n"
			: `No models matching "${search}"\n`;
	}
	const body = renderTable(
		models.map((model) => ({
			provider: model.provider,
			model: model.model,
			context: formatTokenCount(model.context),
			"max-out": formatTokenCount(model.maxOutput),
			thinking: model.thinking ? "yes" : "no",
			images: model.images ? "yes" : "no",
		})),
		["provider", "model", "context", "max-out", "thinking", "images"],
	);
	return `${body}\n`;
};

const listModels = (
	io: PlotCliIo,
	options: {
		readonly cwd: string;
		readonly plotDir: Option.Option<string>;
		readonly agentDir: Option.Option<string>;
		readonly search?: string;
	},
) =>
	runHumanCommand(
		io,
		authPromise(() => makeAuth(options).listModels(options.search)),
		(models) => renderModels(options.search, models),
		"Configure provider auth or pass a valid --cwd/--plot-dir/--agent-dir.",
	);

const renderAuthStatus = (statuses: readonly PlotAuthStatusInfo[]) => {
	if (statuses.length === 0) return "No auth providers found.\n";
	return `${renderTable(
		statuses.map((status) => ({
			provider: status.provider,
			configured: status.configured ? "yes" : "no",
			source: status.source ?? "",
			label: status.label ?? "",
		})),
		["provider", "configured", "source", "label"],
	)}\n`;
};

const readPrompt = (message: string): Promise<string> => {
	const readline = createInterface({
		input: process.stdin,
		output: process.stderr,
	});
	return readline.question(`${message} `).finally(() => readline.close());
};

const providerArg = Argument.string("provider").pipe(
	Argument.withDescription("pi provider id, for example openai-codex"),
);

const searchArg = Argument.string("search").pipe(
	Argument.optional,
	Argument.withDescription("Optional model search text"),
);

const workflowFlag = Flag.optional(
	Flag.string("workflow").pipe(
		Flag.withDescription(
			`Path to the WORKFLOW.md contract to load, default ${DEFAULT_WORKFLOW_PATH} in --cwd`,
		),
	),
);

const sessionIdFlag = Flag.string("session-id").pipe(
	Flag.withDefault("default"),
	Flag.withDescription("Protocol epoch and Plot session identifier"),
);

const cwdFlag = Flag.string("cwd").pipe(
	Flag.withDefault(process.cwd()),
	Flag.withDescription("Working directory used by the agent session"),
);

const plotDirFlag = Flag.optional(
	Flag.string("plot-dir").pipe(
		Flag.withDescription("Plot state directory, defaulting to <cwd>/.plot"),
	),
);

const agentDirFlag = Flag.optional(
	Flag.string("agent-dir").pipe(
		Flag.withDescription(
			"pi-compatible agent directory, default ~/.plot/agent",
		),
	),
);

const sessionDirFlag = Flag.optional(
	Flag.string("session-dir").pipe(
		Flag.withDescription(
			"pi-compatible session directory, default <plot-dir>/sessions",
		),
	),
);

const logLevelFlag = Flag.choice("log-level", [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"none",
] as const).pipe(
	Flag.withDefault("warn" as const),
	Flag.withDescription("Minimum telemetry level written to stderr"),
);

const logFormatFlag = Flag.choice("log-format", [
	"json",
	"logfmt",
	"pretty",
] as const).pipe(
	Flag.withDefault("json" as const),
	Flag.withDescription("Telemetry format written to stderr"),
);

const requestQueueCapacityFlag = Flag.optional(
	Flag.integer("request-queue-capacity").pipe(
		Flag.withDescription("Maximum queued protocol requests"),
	),
);

const eventCapacityFlag = Flag.optional(
	Flag.integer("event-capacity").pipe(
		Flag.withDescription("Maximum in-memory session and agent event capacity"),
	),
);

const replayCapacityFlag = Flag.optional(
	Flag.integer("replay-capacity").pipe(
		Flag.withDescription(
			"Maximum retained protocol events for subscribe replay",
		),
	),
);

const tickIntervalMsFlag = Flag.optional(
	Flag.integer("tick-interval-ms").pipe(
		Flag.withDescription("Optional autonomous periodic tick cadence in millis"),
	),
);

const maxRunDurationMsFlag = Flag.optional(
	Flag.integer("max-run-duration-ms").pipe(
		Flag.withDescription("Optional watchdog timeout for one selected work run"),
	),
);

const splitCommaList = (value: string): readonly string[] =>
	value
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);

const providerFlag = Flag.optional(
	Flag.string("provider").pipe(
		Flag.withDescription("Override WORKFLOW.md agent.provider"),
	),
);

const modelFlag = Flag.optional(
	Flag.string("model").pipe(
		Flag.withDescription(
			"Override WORKFLOW.md agent.model, or use provider/model",
		),
	),
);

const apiKeyFlag = Flag.optional(
	Flag.string("api-key").pipe(
		Flag.withDescription("Runtime API key override for the selected provider"),
	),
);

const thinkingFlag = Flag.optional(
	Flag.choice("thinking", [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
	] as const).pipe(Flag.withDescription("Override WORKFLOW.md agent.thinking")),
);

const toolsFlag = Flag.optional(
	Flag.string("tools").pipe(
		Flag.map(splitCommaList),
		Flag.withDescription("Comma-separated tool allowlist"),
	),
);

const excludeToolsFlag = Flag.optional(
	Flag.string("exclude-tools").pipe(
		Flag.map(splitCommaList),
		Flag.withDescription("Comma-separated tool denylist"),
	),
);

const noToolsFlag = Flag.optional(
	Flag.boolean("no-tools").pipe(
		Flag.withDescription("Disable all inner pi tools"),
	),
);

const noBuiltinToolsFlag = Flag.optional(
	Flag.boolean("no-builtin-tools").pipe(
		Flag.withDescription("Disable built-in pi tools"),
	),
);

const projectConfigFlag = Flag.optional(
	Flag.boolean("approve").pipe(
		Flag.withDescription("Trust project-local pi config with --approve"),
	),
);

const skillFlag = Flag.string("skill").pipe(
	Flag.atMost(256),
	Flag.withDescription("Override workflow resource skill paths"),
);

const promptTemplateFlag = Flag.string("prompt-template").pipe(
	Flag.atMost(256),
	Flag.withDescription("Override workflow prompt template paths"),
);

const noSkillsFlag = Flag.optional(
	Flag.boolean("no-skills").pipe(
		Flag.withDescription("Disable pi skill loading"),
	),
);

const noPromptTemplatesFlag = Flag.optional(
	Flag.boolean("no-prompt-templates").pipe(
		Flag.withDescription("Disable pi prompt template loading"),
	),
);

const noContextFilesFlag = Flag.optional(
	Flag.boolean("no-context-files").pipe(
		Flag.withDescription("Disable AGENTS.md/CLAUDE.md discovery"),
	),
);

const systemPromptFlag = Flag.optional(
	Flag.string("system-prompt").pipe(
		Flag.withDescription("Override pi's inner system prompt"),
	),
);

const appendSystemPromptFlag = Flag.string("append-system-prompt").pipe(
	Flag.atMost(256),
	Flag.withDescription("Append text or file contents to pi's system prompt"),
);

const isNonEmpty = <A>(values: readonly A[]) => values.length > 0;

const makeAgentSessionOverrides = (options: {
	readonly provider: Option.Option<string>;
	readonly model: Option.Option<string>;
	readonly apiKey: Option.Option<string>;
	readonly thinking: Option.Option<
		"off" | "minimal" | "low" | "medium" | "high" | "xhigh"
	>;
	readonly tools: Option.Option<readonly string[]>;
	readonly excludeTools: Option.Option<readonly string[]>;
	readonly noTools: Option.Option<boolean>;
	readonly noBuiltinTools: Option.Option<boolean>;
	readonly projectConfig: Option.Option<boolean>;
	readonly skills: readonly string[];
	readonly promptTemplates: readonly string[];
	readonly noSkills: Option.Option<boolean>;
	readonly noPromptTemplates: Option.Option<boolean>;
	readonly noContextFiles: Option.Option<boolean>;
	readonly systemPrompt: Option.Option<string>;
	readonly appendSystemPrompt: readonly string[];
}): PlotAgentSessionCliOverrides | undefined => {
	const provider = Option.getOrUndefined(options.provider);
	const model = Option.getOrUndefined(options.model);
	const apiKey = Option.getOrUndefined(options.apiKey);
	const thinking = Option.getOrUndefined(options.thinking);
	const tools = Option.getOrUndefined(options.tools);
	const excludeTools = Option.getOrUndefined(options.excludeTools);
	const noToolsFlagValue = Option.getOrUndefined(options.noTools);
	const noBuiltinTools = Option.getOrUndefined(options.noBuiltinTools);
	const projectConfig = Option.getOrUndefined(options.projectConfig);
	const noSkills = Option.getOrUndefined(options.noSkills);
	const noPromptTemplates = Option.getOrUndefined(options.noPromptTemplates);
	const noContextFiles = Option.getOrUndefined(options.noContextFiles);
	const systemPrompt = Option.getOrUndefined(options.systemPrompt);
	const override = {
		...(provider === undefined ? {} : { provider }),
		...(model === undefined ? {} : { model }),
		...(apiKey === undefined ? {} : { apiKey }),
		...(thinking === undefined ? {} : { thinking }),
		...(tools === undefined ? {} : { tools }),
		...(excludeTools === undefined ? {} : { excludeTools }),
		...(noToolsFlagValue === true ? { noTools: true } : {}),
		...(noBuiltinTools === true ? { noTools: "builtin" as const } : {}),
		...(projectConfig === undefined
			? {}
			: { allowProjectConfig: projectConfig }),
		...(isNonEmpty(options.skills) ? { skills: options.skills } : {}),
		...(isNonEmpty(options.promptTemplates)
			? { prompts: options.promptTemplates }
			: {}),
		...(noSkills === true ? { noSkills: true } : {}),
		...(noPromptTemplates === true ? { noPromptTemplates: true } : {}),
		...(noContextFiles === true ? { contextFiles: false } : {}),
		...(systemPrompt === undefined ? {} : { systemPrompt }),
		...(isNonEmpty(options.appendSystemPrompt)
			? { appendSystemPrompt: options.appendSystemPrompt }
			: {}),
	} satisfies PlotAgentSessionCliOverrides;
	return Object.keys(override).length === 0 ? undefined : override;
};

const makeAuth = (options: {
	readonly cwd: string;
	readonly plotDir: Option.Option<string>;
	readonly agentDir: Option.Option<string>;
}) =>
	makePlotAuth(
		resolvePlotPaths({
			cwd: options.cwd,
			...(Option.isNone(options.plotDir)
				? {}
				: { plotDir: options.plotDir.value }),
			...(Option.isNone(options.agentDir)
				? {}
				: { agentDir: options.agentDir.value }),
		}),
	);

const makeListModelsCommand = (io: PlotCliIo) =>
	Command.make(
		"list-models",
		{
			cwd: cwdFlag,
			plotDir: plotDirFlag,
			agentDir: agentDirFlag,
			search: searchArg,
		},
		(options) =>
			listModels(io, {
				cwd: options.cwd,
				plotDir: options.plotDir,
				agentDir: options.agentDir,
				...(Option.isNone(options.search)
					? {}
					: { search: options.search.value }),
			}),
	).pipe(Command.withDescription("List available pi models"));

const makeAuthStatusCommand = (io: PlotCliIo) =>
	Command.make(
		"status",
		{
			cwd: cwdFlag,
			plotDir: plotDirFlag,
			agentDir: agentDirFlag,
			provider: providerArg.pipe(Argument.optional),
		},
		(options) => {
			const provider = Option.getOrUndefined(options.provider);
			return runHumanCommand(
				io,
				authPromise(() => makeAuth(options).status(provider)),
				renderAuthStatus,
				"Pass a provider id from `plot list-models`.",
			);
		},
	).pipe(Command.withDescription("Show configured auth without secrets"));

const makeAuthLogoutCommand = (io: PlotCliIo) =>
	Command.make(
		"logout",
		{
			cwd: cwdFlag,
			plotDir: plotDirFlag,
			agentDir: agentDirFlag,
			provider: providerArg,
		},
		(options) =>
			runHumanCommand(
				io,
				authPromise(() => makeAuth(options).logout(options.provider)).pipe(
					Effect.as(options.provider),
				),
				(provider) => `Logged out from ${provider}.\n`,
				"Pass a valid provider id from `plot list-models`.",
			),
	).pipe(Command.withDescription("Remove stored auth for a provider"));

const makeAuthLoginCommand = (io: PlotCliIo) =>
	Command.make(
		"login",
		{
			cwd: cwdFlag,
			plotDir: plotDirFlag,
			agentDir: agentDirFlag,
			provider: providerArg,
		},
		(options) => {
			const auth = makeAuth(options);
			return runHumanCommand(
				io,
				authPromise(() =>
					auth.login({
						provider: options.provider,
						events: {
							auth: (info) => {
								void Effect.runPromise(
									writeProcessStderr(
										`Open URL: ${info.url}\n${info.instructions ?? ""}\n`,
									),
								);
							},
							deviceCode: (info) => {
								void Effect.runPromise(
									writeProcessStderr(
										`Open ${info.verificationUri} and enter ${info.userCode}\n`,
									),
								);
							},
							prompt: (prompt) => {
								void Effect.runPromise(
									writeProcessStderr(`${prompt.message}\n`),
								);
							},
							select: (prompt) => {
								void Effect.runPromise(
									writeProcessStderr(
										`${prompt.message}: ${prompt.options
											.map((option) => option.label)
											.join(", ")}\n`,
									),
								);
							},
							progress: (message) => {
								void Effect.runPromise(writeProcessStderr(`${message}\n`));
							},
						},
						promptInput: (prompt) => readPrompt(prompt.message),
						manualCodeInput: () =>
							readPrompt("Paste the authorization code or redirect URL:"),
						selectInput: async (prompt) => {
							const answer = await readPrompt(prompt.message);
							return answer.trim() || prompt.options[0]?.id;
						},
					}),
				).pipe(Effect.as(options.provider)),
				(provider) => `Logged in to ${provider}.\n`,
				"Run in an interactive terminal or use the protocol auth_login command with promptResponses.",
			);
		},
	).pipe(Command.withDescription("Run pi-native OAuth login for a provider"));

const makeAuthCommand = (io: PlotCliIo) =>
	Command.make("auth").pipe(
		Command.withDescription("Manage pi-native Plot auth state"),
		Command.withSubcommands([
			makeAuthStatusCommand(io),
			makeAuthLoginCommand(io),
			makeAuthLogoutCommand(io),
		]),
	);

const renderRunEvent = (event: PlotSessionEvent): string | undefined => {
	switch (event.type) {
		case "session_started":
			return `Started session ${event.sessionId}.\n`;
		case "session_shutdown":
			return `Shutdown session ${event.sessionId}.\n`;
		case "agent_session_event":
			if (event.eventType === "agent_start") return "Inner agent started.\n";
			if (event.eventType === "agent_end") return "Inner agent finished.\n";
			return undefined;
		case "plot_agent_event": {
			const plotEvent = event.event;
			if (plotEvent.type === "work_started") {
				return `Started work ${plotEvent.run.workKey}.\n`;
			}
			if (plotEvent.type === "work_completed") {
				return `Completed work ${plotEvent.completion.workKey}: ${plotEvent.completion.status}.\n`;
			}
			return undefined;
		}
	}
};

const makeRunCommand = (io: PlotCliIo) =>
	Command.make(
		"run",
		{
			workflowPath: workflowFlag,
			sessionId: sessionIdFlag,
			cwd: cwdFlag,
			plotDir: plotDirFlag,
			agentDir: agentDirFlag,
			sessionDir: sessionDirFlag,
			logLevel: logLevelFlag,
			logFormat: logFormatFlag,
			requestQueueCapacity: requestQueueCapacityFlag,
			eventCapacity: eventCapacityFlag,
			replayCapacity: replayCapacityFlag,
			tickIntervalMs: tickIntervalMsFlag,
			maxRunDurationMs: maxRunDurationMsFlag,
			provider: providerFlag,
			model: modelFlag,
			apiKey: apiKeyFlag,
			thinking: thinkingFlag,
			tools: toolsFlag,
			excludeTools: excludeToolsFlag,
			noTools: noToolsFlag,
			noBuiltinTools: noBuiltinToolsFlag,
			projectConfig: projectConfigFlag,
			skills: skillFlag,
			promptTemplates: promptTemplateFlag,
			noSkills: noSkillsFlag,
			noPromptTemplates: noPromptTemplatesFlag,
			noContextFiles: noContextFilesFlag,
			systemPrompt: systemPromptFlag,
			appendSystemPrompt: appendSystemPromptFlag,
		},
		(options) => {
			const workflowPath = Option.getOrUndefined(options.workflowPath);
			const plotDir = Option.getOrUndefined(options.plotDir);
			const agentDir = Option.getOrUndefined(options.agentDir);
			const sessionDir = Option.getOrUndefined(options.sessionDir);
			const requestQueueCapacity = Option.getOrUndefined(
				options.requestQueueCapacity,
			);
			const eventCapacity = Option.getOrUndefined(options.eventCapacity);
			const replayCapacity = Option.getOrUndefined(options.replayCapacity);
			const tickIntervalMs = Option.getOrUndefined(options.tickIntervalMs);
			const maxRunDurationMs = Option.getOrUndefined(options.maxRunDurationMs);
			const agentSessionOverrides = makeAgentSessionOverrides(options);
			return runOnce({
				...(workflowPath === undefined ? {} : { workflowPath }),
				sessionId: options.sessionId,
				cwd: options.cwd,
				...(plotDir === undefined ? {} : { plotDir }),
				...(agentDir === undefined ? {} : { agentDir }),
				...(sessionDir === undefined ? {} : { sessionDir }),
				logLevel: options.logLevel as LogLevelFlag,
				logFormat: options.logFormat as LogFormat,
				...(requestQueueCapacity === undefined ? {} : { requestQueueCapacity }),
				...(eventCapacity === undefined ? {} : { eventCapacity }),
				...(replayCapacity === undefined ? {} : { replayCapacity }),
				...(tickIntervalMs === undefined ? {} : { tickIntervalMs }),
				...(maxRunDurationMs === undefined ? {} : { maxRunDurationMs }),
				...(agentSessionOverrides === undefined
					? {}
					: { agentSessionOverrides }),
				...(io.createAgentSession === undefined
					? {}
					: { createAgentSession: io.createAgentSession }),
				onEvent: (event) => {
					const line = renderRunEvent(event);
					return line === undefined ? Effect.void : io.writeStdout(line);
				},
			}).pipe(
				Effect.flatMap((result) => {
					const completion = result.completion;
					const workflowName =
						result.workflow.runtime.name ??
						result.workflow.config["name"] ??
						"workflow";
					const summary = `Workflow ${workflowName} finished with ${completion.status}.\n`;
					const write = io.writeStdout(summary);
					if (completion.status === "succeeded") return write;
					return write.pipe(
						Effect.andThen(
							Effect.fail(
								new PlotCliIoError({
									message: completion.error ?? completion.status,
								}),
							),
						),
					);
				}),
				Effect.catch((error) =>
					writeCliStderr(
						io,
						`Error: ${errorMessage(error)}\nFix: Check WORKFLOW.md, auth status, and provider/model settings.\n`,
					).pipe(Effect.andThen(Effect.fail(error))),
				),
			);
		},
	).pipe(
		Command.withDescription("Run WORKFLOW.md once and print human progress"),
	);

const makeServeStdioCommand = (io: PlotCliIo) =>
	Command.make(
		"stdio",
		{
			workflowPath: workflowFlag,
			sessionId: sessionIdFlag,
			cwd: cwdFlag,
			plotDir: plotDirFlag,
			agentDir: agentDirFlag,
			sessionDir: sessionDirFlag,
			logLevel: logLevelFlag,
			logFormat: logFormatFlag,
			requestQueueCapacity: requestQueueCapacityFlag,
			eventCapacity: eventCapacityFlag,
			replayCapacity: replayCapacityFlag,
			tickIntervalMs: tickIntervalMsFlag,
			maxRunDurationMs: maxRunDurationMsFlag,
			provider: providerFlag,
			model: modelFlag,
			apiKey: apiKeyFlag,
			thinking: thinkingFlag,
			tools: toolsFlag,
			excludeTools: excludeToolsFlag,
			noTools: noToolsFlag,
			noBuiltinTools: noBuiltinToolsFlag,
			projectConfig: projectConfigFlag,
			skills: skillFlag,
			promptTemplates: promptTemplateFlag,
			noSkills: noSkillsFlag,
			noPromptTemplates: noPromptTemplatesFlag,
			noContextFiles: noContextFilesFlag,
			systemPrompt: systemPromptFlag,
			appendSystemPrompt: appendSystemPromptFlag,
		},
		(options) => {
			const workflowPath = Option.getOrUndefined(options.workflowPath);
			const plotDir = Option.getOrUndefined(options.plotDir);
			const agentDir = Option.getOrUndefined(options.agentDir);
			const sessionDir = Option.getOrUndefined(options.sessionDir);
			const requestQueueCapacity = Option.getOrUndefined(
				options.requestQueueCapacity,
			);
			const eventCapacity = Option.getOrUndefined(options.eventCapacity);
			const replayCapacity = Option.getOrUndefined(options.replayCapacity);
			const tickIntervalMs = Option.getOrUndefined(options.tickIntervalMs);
			const maxRunDurationMs = Option.getOrUndefined(options.maxRunDurationMs);
			const agentSessionOverrides = makeAgentSessionOverrides(options);
			return serveStdio({
				...(workflowPath === undefined ? {} : { workflowPath }),
				sessionId: options.sessionId,
				cwd: options.cwd,
				...(plotDir === undefined ? {} : { plotDir }),
				...(agentDir === undefined ? {} : { agentDir }),
				...(sessionDir === undefined ? {} : { sessionDir }),
				logLevel: options.logLevel as LogLevelFlag,
				logFormat: options.logFormat as LogFormat,
				...(requestQueueCapacity === undefined ? {} : { requestQueueCapacity }),
				...(eventCapacity === undefined ? {} : { eventCapacity }),
				...(replayCapacity === undefined ? {} : { replayCapacity }),
				...(tickIntervalMs === undefined ? {} : { tickIntervalMs }),
				...(maxRunDurationMs === undefined ? {} : { maxRunDurationMs }),
				...(agentSessionOverrides === undefined
					? {}
					: { agentSessionOverrides }),
				...(io.createAgentSession === undefined
					? {}
					: { createAgentSession: io.createAgentSession }),
				stdin: io.stdin,
				writeStdout: io.writeStdout,
			});
		},
	).pipe(
		Command.withDescription(
			"Serve the plot.v1 protocol over stdin/stdout JSONL",
		),
	);

export const makePlotCommand = (io: PlotCliIo = processCliIo()) => {
	const serve = Command.make("serve").pipe(
		Command.withDescription("Serve Plot machine integration protocols"),
		Command.withSubcommands([makeServeStdioCommand(io)]),
	);

	return Command.make("plot").pipe(
		Command.withDescription("Autonomous Plot runtime"),
		Command.withSubcommands([
			makeListModelsCommand(io),
			makeRunCommand(io),
			serve,
			makeAuthCommand(io),
		]),
	);
};

export const runPlotCli = (
	args: readonly string[],
	io: PlotCliIo = processCliIo(),
) => Command.runWith(makePlotCommand(io), { version })(args);
