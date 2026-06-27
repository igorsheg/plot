interface StdoutTakeoverState {
	readonly rawStdoutWrite: typeof process.stdout.write;
	readonly rawStderrWrite: typeof process.stderr.write;
	readonly originalStdoutWrite: typeof process.stdout.write;
}

let state: StdoutTakeoverState | undefined;
let tail: Promise<void> = Promise.resolve();

const rawWrite = () =>
	state?.rawStdoutWrite ?? process.stdout.write.bind(process.stdout);

const writeChunk = (text: string): Promise<void> =>
	new Promise((resolve, reject) => {
		rawWrite()(text, (error?: Error | null) => {
			if (error) reject(error);
			else resolve();
		});
	});

export const takeOverStdout = (): void => {
	if (state !== undefined) return;
	const rawStdoutWrite = process.stdout.write.bind(
		process.stdout,
	) as typeof process.stdout.write;
	const rawStderrWrite = process.stderr.write.bind(
		process.stderr,
	) as typeof process.stderr.write;
	state = {
		rawStdoutWrite,
		rawStderrWrite,
		originalStdoutWrite: process.stdout.write,
	};
	process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
		const callback = args.find(
			(arg): arg is (error?: Error | null) => void => typeof arg === "function",
		);
		return rawStderrWrite(String(chunk), callback);
	}) as typeof process.stdout.write;
};

export const restoreStdout = (): void => {
	if (state === undefined) return;
	process.stdout.write = state.originalStdoutWrite;
	state = undefined;
};

export const writeRawStdout = (text: string): Promise<void> => {
	tail = tail.then(() => writeChunk(text));
	return tail;
};

export const flushRawStdout = (): Promise<void> => tail;
