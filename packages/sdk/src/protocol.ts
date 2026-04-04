import type { AgentRuntimeEvent } from "./schemas/events.js";
import type { HealthStatus } from "./schemas/health.js";
import type { RuntimeSnapshot } from "./schemas/orchestrator.js";

// ---- JSON-RPC 2.0 base types ----

export interface JsonRpcNotification<M extends string = string, P = unknown> {
	readonly jsonrpc: "2.0";
	readonly method: M;
	readonly params: P;
}

export interface JsonRpcRequest<M extends string = string, P = unknown> {
	readonly jsonrpc: "2.0";
	readonly method: M;
	readonly params: P;
	readonly id: string | number;
}

export interface JsonRpcResponse<R = unknown> {
	readonly jsonrpc: "2.0";
	readonly result: R;
	readonly id: string | number;
}

export interface JsonRpcError<D = unknown> {
	readonly jsonrpc: "2.0";
	readonly error: {
		readonly code: number;
		readonly message: string;
		readonly data?: D;
	};
	readonly id: string | number | null;
}

// ---- Standard JSON-RPC error codes ----

export const RpcErrorCode = {
	ParseError: -32700,
	InvalidRequest: -32600,
	MethodNotFound: -32601,
	InvalidParams: -32602,
	InternalError: -32603,
	// Application-specific codes
	OrchestratorUnavailable: -32000,
	IssueNotFound: -32001,
} as const;

// ---- Server → Client notifications ----

export type StateUpdateNotification = JsonRpcNotification<
	"state/update",
	{
		readonly snapshot: RuntimeSnapshot;
	}
>;

export type IssueEventNotification = JsonRpcNotification<
	"issue/event",
	{
		readonly issueId: string;
		readonly event: AgentRuntimeEvent;
	}
>;

export type LogNotification = JsonRpcNotification<
	"log/message",
	{
		readonly level: "debug" | "info" | "warning" | "error";
		readonly message: string;
		readonly timestamp: string;
	}
>;

export type ServerNotification =
	| StateUpdateNotification
	| IssueEventNotification
	| LogNotification;

// ---- Client → Server requests ----

export type FocusRequest = JsonRpcRequest<
	"focus",
	{
		readonly issueId: string;
	}
>;

export type UnfocusRequest = JsonRpcRequest<"unfocus", {}>;

export type StopRequest = JsonRpcRequest<"stop", {}>;

export type HealthRequest = JsonRpcRequest<"health", {}>;

export type RefreshRequest = JsonRpcRequest<"refresh", {}>;

export type ClientRequest =
	| FocusRequest
	| UnfocusRequest
	| StopRequest
	| HealthRequest
	| RefreshRequest;

// ---- Response types ----

export type FocusResponse = JsonRpcResponse<{
	readonly events: readonly AgentRuntimeEvent[];
}>;

export type HealthRpcResponse = JsonRpcResponse<{
	readonly status: HealthStatus;
	readonly version?: string;
	readonly uptimeSeconds: number;
	readonly agents: number;
}>;

export type RefreshRpcResponse = JsonRpcResponse<{
	readonly queued: boolean;
}>;

// ---- Helpers ----

export function notification<M extends string, P>(
	method: M,
	params: P,
): JsonRpcNotification<M, P> {
	return { jsonrpc: "2.0", method, params };
}

export function response<R>(
	id: string | number,
	result: R,
): JsonRpcResponse<R> {
	return { jsonrpc: "2.0", result, id };
}

export function rpcError(
	id: string | number | null,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcError {
	return { jsonrpc: "2.0", error: { code, message, data }, id };
}
