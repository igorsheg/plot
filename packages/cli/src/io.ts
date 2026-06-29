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

class PlotCliIoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlotCliIoError";
	}
}

export { errorMessage };

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
