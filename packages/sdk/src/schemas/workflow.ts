export interface TrackerConfig {
	readonly kind: string;
	readonly endpoint?: string;
	readonly apiKey?: string;
	readonly projectSlug?: string;
	readonly dispatchStates?: readonly string[];
	readonly parkedStates?: readonly string[];
	readonly terminalStates?: readonly string[];
	readonly [key: string]: unknown;
}

export interface PollingConfig {
	readonly intervalMs?: number;
}

export interface WorkspaceConfig {
	readonly root?: string;
}

export interface HooksConfig {
	readonly afterCreate?: string;
	readonly beforeRun?: string;
	readonly afterRun?: string;
	readonly beforeRemove?: string;
	readonly timeoutMs?: number;
}

export interface AgentConfig {
	readonly maxConcurrentAgents?: number;
	readonly maxTurns?: number;
	readonly maxRetryBackoffMs?: number;
	readonly maxConcurrentAgentsByState?: Record<string, number>;
	readonly model?: string;
	readonly modelByState?: Record<string, string>;
	readonly modelByLabel?: Record<string, string>;
}

export interface AgentRuntimeConfig {
	readonly command?: string;
	readonly approvalPolicy?: string;
	readonly turnTimeoutMs?: number;
	readonly readTimeoutMs?: number;
	readonly stallTimeoutMs?: number;
}

export interface ServerConfig {
	readonly port?: number;
}

export interface WorkflowConfig {
	readonly tracker?: TrackerConfig;
	readonly polling?: PollingConfig;
	readonly workspace?: WorkspaceConfig;
	readonly hooks?: HooksConfig;
	readonly agent?: AgentConfig;
	readonly codex?: AgentRuntimeConfig;
	readonly server?: ServerConfig;
}

export interface WorkflowDefinition {
	readonly config: WorkflowConfig;
	readonly promptTemplate: string;
}
