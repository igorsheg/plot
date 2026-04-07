import type { RPCSchema } from "electrobun/bun";

// ── Project ──────────────────────────────────────────

export type ProjectStatus =
	| "idle"
	| "launching"
	| "connecting"
	| "streaming"
	| "stopping"
	| "stopped"
	| "failed";

export type ProjectInfo = {
	id: string;
	path: string;
	name: string;
	status: ProjectStatus;
	agentCount: number;
	hasWorkflow: boolean;
	error?: string;
};

// ── Snapshot (typed mirror of SDK RuntimeSnapshot) ───

export type AgentPhase =
	| "idle"
	| "thinking"
	| "tool_execution"
	| "compacting"
	| "retrying";

export type ActiveTool = {
	toolCallId: string;
	toolName: string;
};

export type AgentSession = {
	sessionId: string;
	turnCount: number;
	phase: AgentPhase;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	activeTools: ActiveTool[];
	lastMessage: string | null;
};

export type RunningAgent = {
	issueId: string;
	issueIdentifier: string;
	state: string;
	startedAt: string;
	workspacePath: string | null;
	session: AgentSession;
};

export type RetryingAgent = {
	issueId: string;
	identifier: string;
	attempt: number;
	dueAt: string;
	error: string | null;
};

export type ProjectSnapshot = {
	generatedAt: string;
	running: RunningAgent[];
	retrying: RetryingAgent[];
	totals: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		secondsRunning: number;
	};
};

// ── Providers & Auth ─────────────────────────────────

export type ModelInfo = {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
};

export type ProviderInfo = {
	id: string;
	name: string;
	authenticated: boolean;
	authMode: "oauth" | "api_key";
	modelCount: number;
	models: ModelInfo[];
};

export type AuthState =
	| { phase: "idle"; providerId: string | null }
	| { phase: "authenticating"; providerId: string }
	| { phase: "waitingForCode"; providerId: string; message: string; placeholder?: string }
	| { phase: "success"; providerId: string }
	| { phase: "failed"; providerId: string; error: string };

// ── Workflow ─────────────────────────────────────────
//
// Re-exported from @plot/sdk so the desktop ↔ webview RPC schema stays in
// lockstep with the orchestrator's canonical config shape. Adding fields
// here means: update the SDK type, and the desktop UI/serialization picks
// it up automatically.

export type {
	TrackerConfig,
	PollingConfig,
	WorkspaceConfig,
	HooksConfig,
	AgentConfig,
	AgentRuntimeConfig,
	ServerConfig as WorkflowServerConfig,
	WorkflowConfig,
} from "@plot/sdk";

import type { WorkflowConfig } from "@plot/sdk";

export type WorkflowDocument = {
	config: WorkflowConfig;
	promptBody: string;
};

// ── RPC Schema ───────────────────────────────────────

export type DesktopRPC = {
	bun: RPCSchema<{
		requests: {
			// Projects
			getProjectInfo: { params: { projectId: string }; response: ProjectInfo | null };
			listProjects: { params: {}; response: ProjectInfo[] };
			pickProjectFolder: { params: {}; response: string | null };
			addProject: { params: { folderPath: string }; response: ProjectInfo };
			removeProject: { params: { projectId: string }; response: boolean };

			// Lifecycle
			startProject: { params: { projectId: string }; response: boolean };
			stopProject: { params: { projectId: string }; response: boolean };

			// Workflow
			readWorkflow: { params: { projectPath: string }; response: WorkflowDocument | null };
			saveWorkflow: { params: { projectPath: string; workflow: WorkflowDocument }; response: boolean };
			createWorkflow: { params: { projectPath: string; config: WorkflowConfig }; response: WorkflowDocument };

			// Providers & Auth
			getProviders: { params: {}; response: ProviderInfo[] };
			startAuthFlow: { params: { providerId: string }; response: boolean };
			submitAuthResponse: { params: { value: string }; response: boolean };
			saveApiKey: { params: { providerId: string; key: string }; response: boolean };
			removeApiKey: { params: { providerId: string }; response: boolean };

			// Editor
			openInEditor: { params: { projectPath: string }; response: boolean };

			// Window
			windowClose: { params: {}; response: boolean };
			windowMinimize: { params: {}; response: boolean };
			windowZoom: { params: {}; response: boolean };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			projectUpdated: ProjectInfo;
			authStateChanged: AuthState;
			folderPicked: { path: string };
		};
	}>;
};
