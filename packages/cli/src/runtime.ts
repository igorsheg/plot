import { LoggerLive, withWideEvent } from "@plot/common/observability";
import {
	runSessionOnce,
	serveSessionStdio,
	type RunSessionOnceOptions,
	type ServeSessionStdioOptions,
} from "@plot/session/serve";
import { resolveWorkflowPath } from "@plot/session/workflow";

export type LogLevelFlag =
	| "trace"
	| "debug"
	| "info"
	| "warn"
	| "error"
	| "fatal"
	| "none";

export interface RunInProcessOnceOptions extends RunSessionOnceOptions {
	readonly logLevel: LogLevelFlag;
}
export interface ApiStdioOptions extends ServeSessionStdioOptions {
	readonly logLevel: LogLevelFlag;
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
const workflowPathLogField = (options: {
	readonly cwd: string;
	readonly workflowPath?: string | undefined;
}) =>
	resolveWorkflowPath({
		cwd: options.cwd,
		workflowPath: options.workflowPath,
	});
const provideCliLogger = async <A>(
	options: { readonly logLevel: LogLevelFlag },
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
			() => runSessionOnce(options),
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
			() => serveSessionStdio(options),
		),
	);
