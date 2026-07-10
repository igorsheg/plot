import { spawn } from "node:child_process";
import { errorMessage } from "@plot/common/primitives";
import type { CreatePiAgentSession } from "@plot/session/pi-runner";
import { takeOverStdout, writeRawStdout } from "./stdout-guard.js";

export interface PlotCliIo {
	readonly stdin: AsyncIterable<string | Uint8Array>;
	readonly writeStdout: (text: string) => Promise<void> | void;
	readonly writeStderr?: (text: string) => Promise<void> | void;
	readonly createAgentSession?: CreatePiAgentSession;
	readonly runTui?: (options: unknown) => Promise<void> | void;
	readonly protectStdout?: () => void;
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
	writeStdout: writeRawStdout,
	writeStderr: writeProcessStderr,
	protectStdout: takeOverStdout,
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
