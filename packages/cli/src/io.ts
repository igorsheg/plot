import type { CreateAgentSession } from "@plot/session/agent-session-types";
import type { StdioChunk } from "@plot/session/protocol-stdio";

export interface PlotCliIo {
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (text: string) => Promise<void> | void;
	readonly writeStderr?: (text: string) => Promise<void> | void;
	readonly createAgentSession?: CreateAgentSession;
	readonly runTui?: (options: unknown) => Promise<void> | void;
}

class PlotCliIoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlotCliIoError";
	}
}

export const errorMessage = (error: unknown): string =>
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

export const writeProcessStdout = (text: string) =>
	writeStream(process.stdout, text).catch((e) => {
		throw new PlotCliIoError(errorMessage(e));
	});

export const writeProcessStderr = (text: string) =>
	writeStream(process.stderr, text).catch((e) => {
		throw new PlotCliIoError(errorMessage(e));
	});

export const processCliIo = (): PlotCliIo => ({
	stdin: process.stdin as AsyncIterable<StdioChunk>,
	writeStdout: writeProcessStdout,
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
