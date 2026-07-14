import { Writable } from "node:stream";
import { expect, test } from "bun:test";
import {
	createWorkerProtocolWriter,
	isBrokenPipeError,
} from "../src/internal-session-worker.js";

const brokenPipe = () =>
	Object.assign(new Error("broken pipe"), {
		code: "EPIPE",
		errno: -32,
		syscall: "write",
		fd: 3,
	});

class BrokenProtocol extends Writable {
	override _write(
		_chunk: unknown,
		_encoding: BufferEncoding,
		callback: (error?: Error | null) => void,
	): void {
		const error = brokenPipe();
		this.emit("error", error);
		callback(error);
	}
}

test("internal Session worker protocol writer handles fd 3 EPIPE", async () => {
	const writer = createWorkerProtocolWriter(new BrokenProtocol());
	await expect(writer.writeLine("{}\n")).rejects.toMatchObject({
		code: "EPIPE",
		syscall: "write",
		fd: 3,
	});
	await writer.close();
	expect(isBrokenPipeError(brokenPipe())).toBe(true);
	expect(isBrokenPipeError(new Error("other"))).toBe(false);
});
