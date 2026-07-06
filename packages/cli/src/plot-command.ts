import { basename } from "node:path";
import type { RunIpcOptions } from "@plot/registry/ipc";

const sourceEntry = (value: string | undefined): string | undefined =>
	value !== undefined && /\.[cm]?[jt]sx?$/.test(value) ? value : undefined;

export const resolvePlotCommand = (): NonNullable<RunIpcOptions["cli"]> => {
	const script = sourceEntry(process.argv[1]);
	const isBun = basename(process.execPath) === "bun";
	return {
		command: process.execPath,
		args: isBun && script !== undefined ? [script] : [],
	};
};
