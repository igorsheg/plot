import { makePlotClient, connectSse as sharedConnectSse, type RuntimeSnapshot, type SseStatus, type AgentRuntimeEvent } from "@plot/shared";

export type { RuntimeSnapshot };

const SERVER_URL = process.env["PLOT_URL"] ?? "http://localhost:3000";
const RPC_URL = `${SERVER_URL}/rpc`;
const SSE_URL = `${SERVER_URL}/rpc/events`;

const client = makePlotClient(RPC_URL);

export const getState = (): Promise<RuntimeSnapshot> => client.getState();
export const triggerRefresh = () => client.triggerRefresh();

export function connectSse(
  onEvent: (event: AgentRuntimeEvent) => void,
  onStatus: (s: SseStatus) => void,
): () => void {
  const conn = sharedConnectSse(SSE_URL, onEvent, onStatus);
  return () => conn.close();
}
