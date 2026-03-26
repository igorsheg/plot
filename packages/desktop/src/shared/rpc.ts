import type { RPCSchema } from "electrobun/bun";

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
	error?: string;
};

export type ProviderInfo = {
	id: string;
	authenticated: boolean;
	modelCount: number;
	models: ModelInfo[];
};

export type ModelInfo = {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
};

export type WorkflowTemplate = "github" | "beads" | "blank";

export type WorkflowFrontmatter = {
	tracker?: {
		kind: string;
		dispatchStates?: string[];
		parkedStates?: string[];
		terminalStates?: string[];
	};
	agent?: {
		model?: string;
		maxConcurrentAgents?: number;
		maxTurns?: number;
	};
	workspace?: {
		root?: string;
	};
};

export type WorkflowDocument = {
	config: WorkflowFrontmatter;
	promptBody: string;
};

export type AuthState =
	| { phase: "idle" }
	| { phase: "authenticating" }
	| { phase: "waitingForCode"; message: string; placeholder?: string }
	| { phase: "success" }
	| { phase: "failed"; error: string };

export type DesktopRPC = {
	bun: RPCSchema<{
		requests: {
			getProject: {
				params: { projectId: string };
				response: ProjectInfo | null;
			};
			getProviders: { params: {}; response: ProviderInfo[] };
			getAuthStatus: {
				params: {};
				response: Array<{ id: string; name: string; authenticated: boolean }>;
			};
			startAuthFlow: { params: { providerId: string }; response: boolean };
			submitAuthResponse: { params: { value: string }; response: boolean };
			readWorkflow: {
				params: { projectPath: string };
				response: WorkflowDocument | null;
			};
			createWorkflow: {
				params: { projectPath: string; template: WorkflowTemplate };
				response: WorkflowDocument;
			};
			saveWorkflow: {
				params: { projectPath: string; workflow: WorkflowDocument };
				response: boolean;
			};
			openInEditor: { params: { projectPath: string }; response: boolean };
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
			snapshotUpdate: { projectId: string; snapshot: unknown };
		};
	}>;
};
