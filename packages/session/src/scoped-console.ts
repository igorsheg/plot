import { AsyncLocalStorage } from "node:async_hooks";
import { format } from "node:util";

export interface ConsoleDiagnostic {
	readonly stream: "stdout" | "stderr";
	readonly text: string;
}

type ConsoleMethod = "log" | "info" | "debug" | "warn" | "error";
type ConsoleSink = (diagnostic: ConsoleDiagnostic) => Promise<void> | void;

const storage = new AsyncLocalStorage<ConsoleSink>();
const methods: readonly ConsoleMethod[] = [
	"log",
	"info",
	"debug",
	"warn",
	"error",
];
const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
let scopes = 0;

const streamFor = (method: ConsoleMethod): "stdout" | "stderr" =>
	method === "warn" || method === "error" ? "stderr" : "stdout";

const install = () => {
	if (scopes++ > 0) return;
	for (const method of methods) {
		const original = console[method].bind(console);
		originals.set(method, original);
		console[method] = (...args: unknown[]) => {
			const sink = storage.getStore();
			if (sink === undefined) {
				original(...args);
				return;
			}
			void sink({ stream: streamFor(method), text: `${format(...args)}\n` });
		};
	}
};

const uninstall = () => {
	if (--scopes > 0) return;
	for (const method of methods) {
		const original = originals.get(method);
		if (original !== undefined) console[method] = original;
	}
	originals.clear();
};

export const withScopedConsole = async <A>(
	sink: ConsoleSink,
	work: () => Promise<A>,
): Promise<A> => {
	let writes = Promise.resolve();
	const write: ConsoleSink = (diagnostic) => {
		writes = writes.then(() => sink(diagnostic));
	};
	install();
	let result: A | undefined;
	let failure: unknown;
	try {
		result = await storage.run(write, work);
	} catch (error) {
		failure = error;
	} finally {
		uninstall();
	}
	try {
		await writes;
	} catch (error) {
		failure ??= error;
	}
	if (failure !== undefined) throw failure;
	return result as A;
};
