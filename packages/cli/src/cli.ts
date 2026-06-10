import { createInterface } from "node:readline/promises";
import { runPlotTui } from "@plot/tui/plot-tui";
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
import {
	runDaemon,
	serveStdio,
	type LogFormat,
	type LogLevelFlag,
} from "./runtime.js";

export const version = "0.0.0";
export interface PlotCliIo {
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (text: string) => Promise<void> | void;
	readonly writeStderr?: (text: string) => Promise<void> | void;
	readonly createAgentSession?: CreateAgentSession;
}
class PlotCliIoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlotCliIoError";
	}
}
const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
const writeStream = (stream: NodeJS.WritableStream, text: string) =>
	new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error | null) => {
			if (settled) return;
			settled = true;
			if (error) reject(error);
			else resolve();
		};
		stream.write(text, finish);
	});
const writeProcessStdout = (text: string) =>
	writeStream(process.stdout, text).catch((e) => {
		throw new PlotCliIoError(errorMessage(e));
	});
const writeProcessStderr = (text: string) =>
	writeStream(process.stderr, text).catch((e) => {
		throw new PlotCliIoError(errorMessage(e));
	});
export const processCliIo = (): PlotCliIo => ({
	stdin: process.stdin as AsyncIterable<StdioChunk>,
	writeStdout: writeProcessStdout,
	writeStderr: writeProcessStderr,
});
const writeCliStderr = (io: PlotCliIo, text: string) =>
	(io.writeStderr ?? writeProcessStderr)(text);
const runHumanCommand = async <A>(
	io: PlotCliIo,
	operation: Promise<A>,
	render: (value: A) => string,
	fix: string,
) => {
	try {
		await io.writeStdout(render(await operation));
	} catch (error) {
		await writeCliStderr(io, `Error: ${errorMessage(error)}\nFix: ${fix}\n`);
		throw error;
	}
};
const formatTokenCount = (count: number): string =>
	count >= 1_000_000
		? `${count / 1_000_000}${count % 1_000_000 === 0 ? "" : ""}M`
		: count >= 1_000
			? `${count / 1_000}${count % 1_000 === 0 ? "" : ""}K`
			: count.toString();
const renderTable = (
	rows: readonly Record<string, string>[],
	headers: readonly string[],
) => {
	const widths = Object.fromEntries(
		headers.map((h) => [
			h,
			Math.max(h.length, ...rows.map((r) => r[h]?.length ?? 0)),
		]),
	);
	return [
		headers.map((h) => h.padEnd(widths[h] ?? 0)).join("  "),
		...rows.map((r) =>
			headers.map((h) => (r[h] ?? "").padEnd(widths[h] ?? 0)).join("  "),
		),
	].join("\n");
};
const renderModels = (
	search: string | undefined,
	models: readonly PlotModelInfo[],
) =>
	models.length === 0
		? search === undefined
			? "No models available. Configure provider auth and try again.\n"
			: `No models matching "${search}"\n`
		: `${renderTable(
				models.map((m) => ({
					provider: m.provider,
					model: m.model,
					context: formatTokenCount(m.context),
					"max-out": formatTokenCount(m.maxOutput),
					thinking: m.thinking ? "yes" : "no",
					images: m.images ? "yes" : "no",
				})),
				["provider", "model", "context", "max-out", "thinking", "images"],
			)}\n`;
const renderAuthStatus = (statuses: readonly PlotAuthStatusInfo[]) =>
	statuses.length === 0
		? "No auth providers found.\n"
		: `${renderTable(
				statuses.map((s) => ({
					provider: s.provider,
					configured: s.configured ? "yes" : "no",
					source: s.source ?? "",
					label: s.label ?? "",
				})),
				["provider", "configured", "source", "label"],
			)}\n`;
const readPrompt = (message: string): Promise<string> => {
	const readline = createInterface({
		input: process.stdin,
		output: process.stderr,
	});
	return readline.question(`${message} `).finally(() => readline.close());
};
const splitCommaList = (value: string): readonly string[] =>
	value
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
interface Parsed {
	command: string[];
	flags: Record<string, string | boolean | string[]>;
	args: string[];
}
const parseArgs = (argv: readonly string[]): Parsed => {
	const command: string[] = [];
	const flags: Record<string, string | boolean | string[]> = {};
	const args: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i]!;
		if (token.startsWith("--")) {
			const name = token.slice(2);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				i++;
				const existing = flags[name];
				flags[name] =
					existing === undefined
						? next
						: Array.isArray(existing)
							? [...existing, next]
							: [String(existing), next];
			} else flags[name] = true;
		} else if (
			command.length === 0 ||
			(command[0] === "serve" && command.length === 1) ||
			(command[0] === "auth" && command.length === 1)
		)
			command.push(token);
		else args.push(token);
	}
	return { command, flags, args };
};
const str = (flags: Parsed["flags"], name: string): string | undefined => {
	const v = flags[name];
	return typeof v === "string" ? v : undefined;
};
const bool = (flags: Parsed["flags"], name: string): boolean | undefined =>
	flags[name] === true ? true : undefined;
const int = (flags: Parsed["flags"], name: string): number | undefined => {
	const v = str(flags, name);
	return v === undefined ? undefined : Number.parseInt(v, 10);
};
const many = (flags: Parsed["flags"], name: string): readonly string[] => {
	const v = flags[name];
	return Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
};
const makeAuth = (options: {
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
const makeAgentSessionOverrides = (
	flags: Parsed["flags"],
): PlotAgentSessionCliOverrides | undefined => {
	const tools = str(flags, "tools");
	const excludeTools = str(flags, "exclude-tools");
	const override = {
		...(str(flags, "provider") === undefined
			? {}
			: { provider: str(flags, "provider")! }),
		...(str(flags, "model") === undefined
			? {}
			: { model: str(flags, "model")! }),
		...(str(flags, "api-key") === undefined
			? {}
			: { apiKey: str(flags, "api-key")! }),
		...(str(flags, "thinking") === undefined
			? {}
			: {
					thinking: str(
						flags,
						"thinking",
					) as PlotAgentSessionCliOverrides["thinking"],
				}),
		...(tools === undefined ? {} : { tools: splitCommaList(tools) }),
		...(excludeTools === undefined
			? {}
			: { excludeTools: splitCommaList(excludeTools) }),
		...(bool(flags, "no-tools") ? { noTools: true } : {}),
		...(bool(flags, "no-builtin-tools") ? { noTools: "builtin" as const } : {}),
		...(bool(flags, "approve") === undefined
			? {}
			: { allowProjectConfig: true }),
		...(many(flags, "skill").length ? { skills: many(flags, "skill") } : {}),
		...(many(flags, "prompt-template").length
			? { prompts: many(flags, "prompt-template") }
			: {}),
		...(bool(flags, "no-skills") ? { noSkills: true } : {}),
		...(bool(flags, "no-prompt-templates") ? { noPromptTemplates: true } : {}),
		...(bool(flags, "no-context-files") ? { contextFiles: false } : {}),
		...(str(flags, "system-prompt") === undefined
			? {}
			: { systemPrompt: str(flags, "system-prompt")! }),
		...(many(flags, "append-system-prompt").length
			? { appendSystemPrompt: many(flags, "append-system-prompt") }
			: {}),
	} satisfies PlotAgentSessionCliOverrides;
	return Object.keys(override).length === 0 ? undefined : override;
};
const baseOptions = (p: Parsed) => ({
	...(str(p.flags, "workflow") === undefined
		? {}
		: { workflowPath: str(p.flags, "workflow")! }),
	sessionId: str(p.flags, "session-id") ?? "default",
	cwd: str(p.flags, "cwd") ?? process.cwd(),
	...(str(p.flags, "plot-dir") === undefined
		? {}
		: { plotDir: str(p.flags, "plot-dir")! }),
	...(str(p.flags, "agent-dir") === undefined
		? {}
		: { agentDir: str(p.flags, "agent-dir")! }),
	...(str(p.flags, "session-dir") === undefined
		? {}
		: { sessionDir: str(p.flags, "session-dir")! }),
	logLevel: (str(p.flags, "log-level") ?? "warn") as LogLevelFlag,
	logFormat: (str(p.flags, "log-format") ?? "json") as LogFormat,
	...(int(p.flags, "request-queue-capacity") === undefined
		? {}
		: { requestQueueCapacity: int(p.flags, "request-queue-capacity")! }),
	...(int(p.flags, "event-capacity") === undefined
		? {}
		: { eventCapacity: int(p.flags, "event-capacity")! }),
	...(int(p.flags, "replay-capacity") === undefined
		? {}
		: { replayCapacity: int(p.flags, "replay-capacity")! }),
	...(int(p.flags, "tick-interval-ms") === undefined
		? {}
		: { tickIntervalMs: int(p.flags, "tick-interval-ms")! }),
	...(int(p.flags, "max-run-duration-ms") === undefined
		? {}
		: { maxRunDurationMs: int(p.flags, "max-run-duration-ms")! }),
	...(makeAgentSessionOverrides(p.flags) === undefined
		? {}
		: { agentSessionOverrides: makeAgentSessionOverrides(p.flags)! }),
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const textFromContent = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content
					.flatMap((b) =>
						isRecord(b) && b["type"] === "text" && typeof b["text"] === "string"
							? [b["text"]]
							: [],
					)
					.join("\n")
			: "";
const finalAssistantTextFromAgentEnd = (event: unknown): string | undefined => {
	if (!isRecord(event) || !Array.isArray(event["messages"])) return undefined;
	const assistant = event["messages"].findLast(
		(m) => isRecord(m) && m["role"] === "assistant",
	);
	if (!isRecord(assistant)) return undefined;
	const text = textFromContent(assistant["content"]).trim();
	return text.length ? text : undefined;
};
const renderRunEvent = (event: PlotSessionEvent): string | undefined => {
	if (event.type === "session_started")
		return `Started session ${event.sessionId}.\n`;
	if (event.type === "session_shutdown")
		return `Shutdown session ${event.sessionId}.\n`;
	if (event.type === "agent_session_event") {
		if (event.eventType === "agent_start") return "Inner agent started.\n";
		if (event.eventType === "agent_end") {
			const text = finalAssistantTextFromAgentEnd(event.event);
			return text === undefined
				? "Inner agent finished.\n"
				: `\nFinal assistant message:\n${text}\n\nInner agent finished.\n`;
		}
	}
	if (event.type === "plot_agent_event") {
		if (event.event.type === "work_started")
			return `Started work ${event.event.run.workKey}.\n`;
		if (event.event.type === "work_completed")
			return `Completed work ${event.event.completion.workKey}: ${event.event.completion.status}.\n`;
	}
	return undefined;
};
export const runPlotCli = async (
	args: readonly string[],
	io: PlotCliIo = processCliIo(),
): Promise<void> => {
	const p = parseArgs(args);
	const [cmd, sub] = p.command;
	if (cmd === undefined || cmd === "--help" || cmd === "help") {
		await io.writeStdout(
			`plot ${version}\nCommands: list-models, auth status|login|logout, run, tui, serve stdio\nDefault workflow: ${DEFAULT_WORKFLOW_PATH}\n`,
		);
		return;
	}
	if (cmd === "list-models") {
		const cwd = str(p.flags, "cwd") ?? process.cwd();
		const search = p.args[0];
		const plotDir = str(p.flags, "plot-dir");
		const agentDir = str(p.flags, "agent-dir");
		return runHumanCommand(
			io,
			makeAuth({
				cwd,
				...(plotDir === undefined ? {} : { plotDir }),
				...(agentDir === undefined ? {} : { agentDir }),
			}).listModels(search),
			(models) => renderModels(search, models),
			"Configure provider auth or pass a valid --cwd/--plot-dir/--agent-dir.",
		);
	}
	if (cmd === "auth") {
		const cwd = str(p.flags, "cwd") ?? process.cwd();
		const plotDir = str(p.flags, "plot-dir");
		const agentDir = str(p.flags, "agent-dir");
		const auth = makeAuth({
			cwd,
			...(plotDir === undefined ? {} : { plotDir }),
			...(agentDir === undefined ? {} : { agentDir }),
		});
		const provider = p.args[0] ?? str(p.flags, "provider");
		if (sub === "status")
			return runHumanCommand(
				io,
				auth.status(provider),
				renderAuthStatus,
				"Pass a provider id from `plot list-models`.",
			);
		if (sub === "logout" && provider)
			return runHumanCommand(
				io,
				auth.logout(provider).then(() => provider),
				(x) => `Logged out from ${x}.\n`,
				"Pass a valid provider id from `plot list-models`.",
			);
		if (sub === "login" && provider)
			return runHumanCommand(
				io,
				auth
					.login({
						provider,
						events: {
							auth: (info) => {
								void writeProcessStderr(
									`Open URL: ${info.url}\n${info.instructions ?? ""}\n`,
								);
							},
							deviceCode: (info) => {
								void writeProcessStderr(
									`Open ${info.verificationUri} and enter ${info.userCode}\n`,
								);
							},
							prompt: (prompt) => {
								void writeProcessStderr(`${prompt.message}\n`);
							},
							select: (prompt) => {
								void writeProcessStderr(
									`${prompt.message}: ${prompt.options.map((o) => o.label).join(", ")}\n`,
								);
							},
							progress: (message) => {
								void writeProcessStderr(`${message}\n`);
							},
						},
						promptInput: (prompt) => readPrompt(prompt.message),
						manualCodeInput: () =>
							readPrompt("Paste the authorization code or redirect URL:"),
						selectInput: async (prompt) =>
							(await readPrompt(prompt.message)).trim() ||
							prompt.options[0]?.id,
					})
					.then(() => provider),
				(x) => `Logged in to ${x}.\n`,
				"Run in an interactive terminal or use the protocol auth_login command with promptResponses.",
			);
	}
	if (cmd === "run") {
		try {
			await runDaemon({
				...baseOptions(p),
				...(io.createAgentSession === undefined
					? {}
					: { createAgentSession: io.createAgentSession }),
				onEvent: async (event) => {
					const line = renderRunEvent(event);
					if (line) await io.writeStdout(line);
				},
			});
		} catch (error) {
			await writeCliStderr(
				io,
				`Error: ${errorMessage(error)}\nFix: Check WORKFLOW.md, auth status, and provider/model settings.\n`,
			);
			throw error;
		}
		return;
	}
	if (cmd === "tui")
		return runPlotTui({
			...baseOptions(p),
			...(io.createAgentSession === undefined
				? {}
				: { createAgentSession: io.createAgentSession }),
		});
	if (cmd === "serve" && sub === "stdio")
		return serveStdio({
			...baseOptions(p),
			...(io.createAgentSession === undefined
				? {}
				: { createAgentSession: io.createAgentSession }),
			stdin: io.stdin,
			writeStdout: io.writeStdout,
		});
	throw new Error(`unknown command: ${p.command.join(" ")}`);
};
export const makePlotCommand = (_io: PlotCliIo = processCliIo()) => ({
	version,
});
