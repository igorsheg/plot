import type { RPCSchema } from "electrobun/bun";

export type ProjectStatus =
  | "idle"
  | "starting"
  | "running"
  | "error"
  | "stopped";

export type ProjectInfo = {
  path: string;
  name: string;
  status: ProjectStatus;
  pid?: number;
  error?: string;
};

export type WorkflowFrontmatter = {
  tracker?: {
    kind: string;
    endpoint?: string;
    dispatchStates?: string[];
    parkedStates?: string[];
    terminalStates?: string[];
    [key: string]: unknown;
  };
  polling?: {
    intervalMs?: number;
  };
  workspace?: {
    root?: string;
  };
  hooks?: {
    afterCreate?: string;
    beforeRun?: string;
    afterRun?: string;
    beforeRemove?: string;
    timeoutMs?: number;
  };
  agent?: {
    maxConcurrentAgents?: number;
    maxTurns?: number;
    maxRetryBackoffMs?: number;
    model?: string;
    modelByState?: Record<string, string>;
    modelByLabel?: Record<string, string>;
  };
  codex?: {
    command?: string;
    approvalPolicy?: string;
    turnTimeoutMs?: number;
    readTimeoutMs?: number;
    stallTimeoutMs?: number;
  };
  server?: {
    port?: number;
  };
  [key: string]: unknown;
};

export type ParsedWorkflow = {
  frontmatter: WorkflowFrontmatter;
  body: string;
};

export type DesktopRPC = {
  bun: RPCSchema<{
    requests: {
      listProjects: { params: {}; response: ProjectInfo[] };
      addProject: { params: { path: string }; response: ProjectInfo };
      removeProject: { params: { path: string }; response: boolean };
      readWorkflow: {
        params: { projectPath: string };
        response: ParsedWorkflow | null;
      };
      saveWorkflow: {
        params: { projectPath: string; workflow: ParsedWorkflow };
        response: boolean;
      };
      startAgent: {
        params: { projectPath: string };
        response: { pid: number };
      };
      stopAgent: { params: { projectPath: string }; response: boolean };
      getAgentStatus: {
        params: { projectPath: string };
        response: ProjectStatus;
      };
      pickFolder: { params: {}; response: string | null };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      agentStatusUpdate: {
        projectPath: string;
        status: ProjectStatus;
        error?: string;
      };
      agentLog: { projectPath: string; line: string };
      processExited: { projectPath: string; code: number | null };
    };
  }>;
};
