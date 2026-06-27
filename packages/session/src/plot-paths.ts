import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface PlotPathOptions {
	readonly cwd: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
}

export interface PlotPaths {
	readonly cwd: string;
	readonly plotDir: string;
	readonly agentDir: string;
	readonly sessionDir: string;
	readonly skillsDir: string;
	readonly extensionsDir: string;
	readonly promptsDir: string;
}

export interface PlotSupervisorPathOptions {
	readonly supervisorDir?: string;
}

export interface PlotSupervisorPaths {
	readonly supervisorDir: string;
	readonly socketPath: string;
	readonly instancesPath: string;
}

const CONFIG_DIR_NAME = ".plot";
const ENV_CONFIG_DIR = "PLOT_CONFIG_DIR";
const ENV_SUPERVISOR_DIR = "PLOT_SUPERVISOR_DIR";

export const resolvePlotPaths = (options: PlotPathOptions): PlotPaths => {
	const cwd = resolve(options.cwd);
	const plotDir = resolve(cwd, options.plotDir ?? ".plot");
	return {
		cwd,
		plotDir,
		agentDir: resolve(cwd, options.agentDir ?? `${homedir()}/.plot/agent`),
		sessionDir: resolve(cwd, options.sessionDir ?? `${plotDir}/sessions`),
		skillsDir: resolve(cwd, `${plotDir}/skills`),
		extensionsDir: resolve(cwd, `${plotDir}/extensions`),
		promptsDir: resolve(cwd, `${plotDir}/prompts`),
	};
};

export const resolvePlotSupervisorDir = (
	options: PlotSupervisorPathOptions = {},
): string => {
	if (options.supervisorDir !== undefined)
		return resolve(options.supervisorDir);
	const envSupervisorDir = process.env[ENV_SUPERVISOR_DIR];
	if (envSupervisorDir !== undefined) return resolve(envSupervisorDir);
	return join(
		resolve(process.env[ENV_CONFIG_DIR] ?? join(homedir(), CONFIG_DIR_NAME)),
		"supervisor",
	);
};

export const resolvePlotSupervisorPaths = (
	options: PlotSupervisorPathOptions = {},
): PlotSupervisorPaths => {
	const supervisorDir = resolvePlotSupervisorDir(options);
	return {
		supervisorDir,
		socketPath: join(supervisorDir, "supervisor.sock"),
		instancesPath: join(supervisorDir, "instances.json"),
	};
};

export const resolvePlotSupervisorSocketPath = (
	options: PlotSupervisorPathOptions = {},
): string => resolvePlotSupervisorPaths(options).socketPath;

export const resolvePlotSupervisorInstancesPath = (
	options: PlotSupervisorPathOptions = {},
): string => resolvePlotSupervisorPaths(options).instancesPath;
