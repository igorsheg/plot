import {
	makePlotClient,
	connectSse as sharedConnectSse,
	type RuntimeSnapshot,
	type RefreshResult,
	type SseStatus,
	type AgentRuntimeEvent,
} from "@plot/sdk";

export type { RuntimeSnapshot };

export interface RuntimeApi {
	getState: () => Promise<RuntimeSnapshot>;
	triggerRefresh: () => Promise<RefreshResult>;
	connectEvents: (
		onEvent: (event: AgentRuntimeEvent) => void,
		onStatus: (status: SseStatus) => void,
	) => () => void;
}

export function createHttpRuntimeApi(
	serverUrl = process.env["PLOT_URL"] ?? "http://localhost:3000",
): RuntimeApi {
	const rpcUrl = `${serverUrl}/rpc`;
	const sseUrl = `${serverUrl}/rpc/events`;
	const client = makePlotClient(rpcUrl);

	return {
		getState: () => client.getState(),
		triggerRefresh: () => client.triggerRefresh(),
		connectEvents: (onEvent, onStatus) => {
			const conn = sharedConnectSse(sseUrl, onEvent, onStatus);
			return () => conn.close();
		},
	};
}
