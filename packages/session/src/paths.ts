import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface SessionPaths {
	readonly cwd: string;
	readonly plotDir: string;
	readonly agentDir: string;
	readonly sessionDir: string;
	readonly skillsDir: string;
	readonly extensionsDir: string;
	readonly promptsDir: string;
}

export interface SessionPathOptions {
	readonly cwd: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
}

export const resolveSessionPaths = (
	options: SessionPathOptions,
): SessionPaths => {
	const cwd = resolve(options.cwd);
	const plotDir = resolve(cwd, options.plotDir ?? ".plot");
	const agentDir = resolve(
		cwd,
		options.agentDir ?? join(homedir(), ".plot", "agent"),
	);
	const sessionDir = resolve(
		cwd,
		options.sessionDir ?? join(plotDir, "sessions"),
	);
	return {
		cwd,
		plotDir,
		agentDir,
		sessionDir,
		skillsDir: resolve(cwd, join(plotDir, "skills")),
		extensionsDir: resolve(cwd, join(plotDir, "extensions")),
		promptsDir: resolve(cwd, join(plotDir, "prompts")),
	};
};
