import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { basename } from "node:path";
import type { ProcessCommand } from "@plot/session-manager/session-process";
import { VERSION } from "./package.js";

export type Command = ProcessCommand;

const sourceEntry = (value: string | undefined): string | undefined =>
	value !== undefined && /\.[cm]?[jt]sx?$/.test(value) ? value : undefined;

export const resolveCommand = (): Command => {
	const script = sourceEntry(process.argv[1]);
	const isBun = basename(process.execPath) === "bun";
	return {
		command: process.execPath,
		args: isBun && script !== undefined ? [script] : [],
	};
};

export const processIdentity = (command: Command): string => {
	const files = [command.command, ...command.args].map((path) => {
		try {
			const stat = statSync(path);
			return { path, size: stat.size, modified: stat.mtimeMs };
		} catch {
			return { path };
		}
	});
	const executable = createHash("sha256")
		.update(JSON.stringify(files))
		.digest("hex")
		.slice(0, 12);
	return `${VERSION}+${executable}`;
};
