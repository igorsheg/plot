import { homedir } from "node:os";
import { resolve } from "node:path";

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
