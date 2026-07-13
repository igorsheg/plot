import { openSessionManager } from "@plot/session-manager/ipc";
import type { SessionManagerRuntime } from "@plot/session-manager/manager";
import { getCliIo } from "./cli-context.js";
import { resolvePlotCommand } from "./plot-command.js";

export const getSessionManager = (): Promise<SessionManagerRuntime> => {
	const injected = getCliIo().sessionManager;
	if (injected !== undefined) return Promise.resolve(injected);
	return openSessionManager({ cli: resolvePlotCommand() });
};
