import { LoggerLive, withWideEvent } from "@plot/common/observability";
import type { AgentSessionOverrides } from "@plot/session/agent-session";
import { createProtocolSessionHost } from "@plot/session/host";
import type { CreatePiAgentSession } from "@plot/session/pi-runner";
import {
	decodeClientRequestLine,
	encodeServerRecordLine,
} from "@plot/session/protocol-codec";
import type { EventLogRecord } from "@plot/session/event-log";
import { resolveWorkflowPath } from "@plot/session/workflow";

export type LogLevelFlag =
	| "trace"
	| "debug"
	| "info"
	| "warn"
	| "error"
	| "fatal"
	| "none";
interface BaseRunOptions {
	readonly workflowPath?: string;
	readonly sessionId: string;
	readonly cwd: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
	readonly logLevel: LogLevelFlag;
	readonly requestQueueCapacity?: number;
	readonly eventCapacity?: number;
	readonly eventBufferCapacity?: number;
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly agentSessionOverrides?: AgentSessionOverrides;
	readonly createAgentSession?: CreatePiAgentSession;
}
export interface ApiStdioOptions extends BaseRunOptions {
	readonly stdin: AsyncIterable<string | Uint8Array>;
	readonly writeStdout: (line: string) => Promise<void> | void;
}
export interface RunInProcessOnceOptions extends BaseRunOptions {
	readonly onEvent?: (event: EventLogRecord) => Promise<void> | void;
}

const toLogLevel = (
	level: LogLevelFlag,
): "Debug" | "Info" | "Warning" | "Error" =>
	level === "debug" || level === "trace"
		? "Debug"
		: level === "error" || level === "fatal"
			? "Error"
			: level === "warn"
				? "Warning"
				: "Info";
const workflowPathLogField = (options: BaseRunOptions) =>
	resolveWorkflowPath({
		cwd: options.cwd,
		...(options.workflowPath === undefined
			? {}
			: { workflowPath: options.workflowPath }),
	});
const provideCliLogger = async <A>(
	options: BaseRunOptions,
	work: () => Promise<A> | A,
): Promise<A> => {
	LoggerLive({ level: toLogLevel(options.logLevel), stderr: true });
	return work();
};

export const runInProcessOnce = (
	options: RunInProcessOnceOptions,
): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.run_once",
			{
				workflow_path: workflowPathLogField(options),
				session_id: options.sessionId,
			},
			async () => {
				const host = await createProtocolSessionHost(options);
				try {
					await host.runtime.start();
					await host.runtime.tickOnce();
				} finally {
					await host.shutdown();
				}
			},
		),
	);

export const runApiStdio = (options: ApiStdioOptions): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.api_stdio",
			{
				workflow_path: workflowPathLogField(options),
				session_id: options.sessionId,
			},
			async () => {
				const host = await createProtocolSessionHost(options);
				const write = (
					record: Awaited<ReturnType<typeof host.protocol.welcome>>,
				) => options.writeStdout(encodeServerRecordLine(record));
				await write(await host.protocol.welcome());
				void (async () => {
					for await (const record of host.protocol.output())
						await options.writeStdout(encodeServerRecordLine(record));
				})();
				const decoder = new TextDecoder();
				let buffer = "";
				for await (const chunk of options.stdin) {
					buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk);
					for (;;) {
						const index = buffer.indexOf("\n");
						if (index === -1) break;
						const line = buffer.slice(0, index).trim();
						buffer = buffer.slice(index + 1);
						if (line !== "") {
							// eslint-disable-next-line no-await-in-loop -- stdin protocol requests are submitted in order.
							await host.protocol.submit(decodeClientRequestLine(line));
						}
					}
				}
			},
		),
	);
