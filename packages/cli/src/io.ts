import { spawn } from "node:child_process";
import { errorMessage } from "@plot/common/primitives";
import type { SessionManagerRuntime } from "@plot/session-manager/manager";

export interface PlotCliIo {
	readonly stdin: AsyncIterable<string | Uint8Array>;
	readonly writeStdout: (text: string) => Promise<void> | void;
	readonly writeStderr?: (text: string) => Promise<void> | void;
	readonly sessionManager?: SessionManagerRuntime;
	readonly runTui?: (options: unknown) => Promise<void> | void;
}

export const openBrowser = (url: string): void => {
	const [command, args]: [string, string[]] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["rundll32", ["url.dll,FileProtocolHandler", url]]
				: ["xdg-open", [url]];
	spawn(command, args, { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
};

const writeStream = (stream: NodeJS.WritableStream, text: string) =>
	new Promise<void>((resolve, reject) =>
		stream.write(text, (error?: Error | null) => {
			if (error) reject(error);
			else resolve();
		}),
	);

export const writeProcessStderr = (text: string) =>
	writeStream(process.stderr, text);

export const processCliIo = (): PlotCliIo => ({
	stdin: process.stdin as AsyncIterable<string | Uint8Array>,
	writeStdout: (text) => writeStream(process.stdout, text),
	writeStderr: writeProcessStderr,
});

export const writeCliStderr = (io: PlotCliIo, text: string) =>
	(io.writeStderr ?? writeProcessStderr)(text);

export const runHumanCommand = async <A>(
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
