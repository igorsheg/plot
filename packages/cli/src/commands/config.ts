import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineCommand, type ParsedArgs } from "citty";
import { resolveSessionPaths } from "@plot/session/paths";
import { authPathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { bool, str } from "../options.js";
import { table } from "../render.js";

const configKeys = [
	"defaultProvider",
	"defaultModel",
	"defaultThinkingLevel",
] as const;

type ConfigKey = (typeof configKeys)[number];

type Settings = Partial<Record<ConfigKey, string>>;

const isConfigKey = (value: string): value is ConfigKey =>
	(configKeys as readonly string[]).includes(value);

const configPath = (args: ParsedArgs): string => {
	const paths = resolveSessionPaths({
		cwd: str(args, "cwd") ?? process.cwd(),
		plotDir: str(args, "plot-dir"),
		agentDir: str(args, "agent-dir"),
	} as Parameters<typeof resolveSessionPaths>[0]);
	if (bool(args, "global"))
		return resolve(paths.agentDir, "..", "settings.json");
	return resolve(paths.plotDir, "settings.json");
};

const readSettings = async (path: string): Promise<Settings> => {
	try {
		const value = JSON.parse(await readFile(path, "utf8")) as unknown;
		if (typeof value !== "object" || value === null || Array.isArray(value))
			throw new Error(`${path} must contain a JSON object`);
		const settings: Settings = {};
		for (const key of configKeys) {
			const field = (value as Record<string, unknown>)[key];
			if (field !== undefined && typeof field !== "string")
				throw new Error(`${path} ${key} must be a string`);
			if (field) settings[key] = field;
		}
		return settings;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
};

const writeSettings = async (
	path: string,
	settings: Settings,
): Promise<void> => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
};

const keyArg = {
	key: {
		type: "positional",
		description:
			"Config key: defaultProvider|defaultModel|defaultThinkingLevel.",
		required: true,
	},
} as const;

const globalFlag = {
	global: {
		type: "boolean",
		description: "Use global Plot settings instead of project settings.",
	},
} as const;

const configPathArgs = { ...authPathArgs, ...globalFlag } as const;

const listSettings = async (args: ParsedArgs): Promise<void> => {
	const io = getCliIo();
	const path = configPath(args);
	const settings = await readSettings(path);
	const rows = configKeys.flatMap((key) => {
		const value = settings[key];
		return value === undefined ? [] : [[key, value]];
	});
	await io.writeStdout(
		rows.length === 0 ? `No config set in ${path}.\n` : `${table(rows)}\n`,
	);
};

export const configCommand = defineCommand({
	meta: { name: "config", description: "Read and write Plot settings." },
	subCommands: {
		list: defineCommand({
			meta: { name: "list", description: "List Plot settings." },
			args: configPathArgs,
			run: ({ args }) => listSettings(args),
		}),
		get: defineCommand({
			meta: { name: "get", description: "Read one Plot setting." },
			args: { ...keyArg, ...configPathArgs },
			run: async ({ args }) => {
				const key = str(args, "key");
				if (key === undefined || !isConfigKey(key))
					throw new Error(`Unknown config key: ${key ?? ""}`);
				const path = configPath(args);
				const settings = await readSettings(path);
				await getCliIo().writeStdout(
					settings[key] === undefined
						? `${key} is not set in ${path}.\n`
						: `${settings[key]}\n`,
				);
			},
		}),
		set: defineCommand({
			meta: { name: "set", description: "Write one Plot setting." },
			args: {
				...keyArg,
				value: {
					type: "positional",
					description: "Setting value.",
					required: true,
				},
				...configPathArgs,
			},
			run: async ({ args }) => {
				const key = str(args, "key");
				const value = str(args, "value");
				if (key === undefined || !isConfigKey(key))
					throw new Error(`Unknown config key: ${key ?? ""}`);
				if (value === undefined || value.length === 0)
					throw new Error("config value required");
				const path = configPath(args);
				const settings = await readSettings(path);
				settings[key] = value;
				await writeSettings(path, settings);
				await getCliIo().writeStdout(`Set ${key} in ${path}.\n`);
			},
		}),
	},
});
