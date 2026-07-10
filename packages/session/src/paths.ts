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

const sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const validateSessionId = (sessionId: string): string => {
	if (sessionIdPattern.test(sessionId)) return sessionId;
	throw new Error(
		"session id must be 1-128 letters, digits, dots, underscores, or hyphens and start with a letter or digit",
	);
};

export const sessionEventLogPath = (
	sessionDir: string,
	sessionId: string,
): string => join(sessionDir, `${validateSessionId(sessionId)}.jsonl`);
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
