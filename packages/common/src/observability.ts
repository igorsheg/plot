export type WideEventLevel = "debug" | "info" | "warning" | "error";
export type Fields = Record<string, unknown>;

let minimumLevel: WideEventLevel = "info";
let logToStderr = false;

const priority: Record<WideEventLevel, number> = {
	debug: 10,
	info: 20,
	warning: 30,
	error: 40,
};

export interface LoggerLiveOptions {
	readonly stderr?: boolean;
	readonly level?: "Debug" | "Info" | "Warning" | "Error";
}

const normalizeLevel = (level: LoggerLiveOptions["level"]): WideEventLevel => {
	switch (level) {
		case "Debug":
			return "debug";
		case "Warning":
			return "warning";
		case "Error":
			return "error";
		case "Info":
		case undefined:
			return "info";
	}
};

export const LoggerLive = (options: LoggerLiveOptions = {}) => {
	minimumLevel = normalizeLevel(options.level);
	logToStderr = options.stderr ?? false;
	return { run: async <A>(thunk: () => Promise<A> | A) => thunk() };
};

export const logWideEvent = async (
	fields: Fields,
	level: WideEventLevel = "info",
): Promise<void> => {
	if (priority[level] < priority[minimumLevel]) return;
	const record = { timestamp: new Date().toISOString(), level, ...fields };
	const line = `${JSON.stringify(record)}\n`;
	if (logToStderr) process.stderr.write(line);
};

export const withWideEvent = async <A>(
	operation: string,
	fields: Fields,
	work: (() => Promise<A> | A) | Promise<A>,
): Promise<A> => {
	const started = Date.now();
	try {
		const value = await (typeof work === "function" ? work() : work);
		await logWideEvent({
			operation,
			outcome: "success",
			duration_ms: Date.now() - started,
			...fields,
		});
		return value;
	} catch (error) {
		await logWideEvent(
			{
				operation,
				outcome: "error",
				duration_ms: Date.now() - started,
				error: error instanceof Error ? error.message : String(error),
				...fields,
			},
			"error",
		);
		throw error;
	}
};

export const withFields = async <A>(
	_fields: Fields,
	work: (() => Promise<A> | A) | Promise<A>,
): Promise<A> => (typeof work === "function" ? work() : work);
