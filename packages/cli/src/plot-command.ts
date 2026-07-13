import { basename } from "node:path";

export interface PlotCommand {
	readonly command: string;
	readonly args: readonly string[];
}

const sourceEntry = (value: string | undefined): string | undefined =>
	value !== undefined && /\.[cm]?[jt]sx?$/.test(value) ? value : undefined;

export const resolvePlotCommand = (): PlotCommand => {
	const script = sourceEntry(process.argv[1]);
	const isBun = basename(process.execPath) === "bun";
	return {
		command: process.execPath,
		args: isBun && script !== undefined ? [script] : [],
	};
};
