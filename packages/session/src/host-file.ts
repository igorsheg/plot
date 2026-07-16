import { createJsonlSessionEventStore } from "./history.js";
import { createSessionHost, type SessionHost } from "./host.js";
import { sessionEventLogPath } from "./paths.js";
import {
	prepareWorkflowForSession,
	type PrepareWorkflowOptions,
} from "./preparation.js";

export interface CreateFileSessionHostOptions extends PrepareWorkflowOptions {
	readonly sessionId?: string;
}

export const createSessionHostFromFile = async (
	options: CreateFileSessionHostOptions,
): Promise<SessionHost> => {
	const prepared = await prepareWorkflowForSession(options);
	const createEventStore = (sessionId: string) =>
		createJsonlSessionEventStore(
			sessionEventLogPath(prepared.paths.sessionDir, sessionId),
		);
	if (options.sessionId === undefined)
		return createSessionHost({ prepared, createEventStore });
	return createSessionHost({
		prepared,
		sessionId: options.sessionId,
		createEventStore,
	});
};
