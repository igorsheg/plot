import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface LocalPlotServerPathOptions {
	readonly homeDir?: string;
	readonly serverDir?: string;
}

export interface LocalPlotServerPaths {
	readonly plotDir: string;
	readonly serverDir: string;
	readonly tokenPath: string;
	readonly metadataPath: string;
	readonly catalogPath: string;
	readonly logsDir: string;
}

export const resolveLocalPlotServerPaths = (
	options: LocalPlotServerPathOptions = {},
): LocalPlotServerPaths => {
	const plotDir = resolve(options.homeDir ?? homedir(), ".plot");
	const serverDir = resolve(options.serverDir ?? join(plotDir, "server"));
	return {
		plotDir,
		serverDir,
		tokenPath: join(serverDir, "token"),
		metadataPath: join(serverDir, "local.json"),
		catalogPath: join(serverDir, "catalog.json"),
		logsDir: join(serverDir, "logs"),
	};
};
