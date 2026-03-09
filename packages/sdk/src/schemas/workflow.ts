import { Schema } from "effect";

export class TrackerConfig extends Schema.Class<TrackerConfig>("TrackerConfig")({
  kind: Schema.String,
  endpoint: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  projectSlug: Schema.optional(Schema.String),
  dispatchStates: Schema.optional(Schema.Array(Schema.String)),
  parkedStates: Schema.optional(Schema.Array(Schema.String)),
  terminalStates: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class PollingConfig extends Schema.Class<PollingConfig>("PollingConfig")({
  intervalMs: Schema.optional(Schema.Number),
}) {}

export class WorkspaceConfig extends Schema.Class<WorkspaceConfig>("WorkspaceConfig")({
  root: Schema.optional(Schema.String),
}) {}

export class HooksConfig extends Schema.Class<HooksConfig>("HooksConfig")({
  afterCreate: Schema.optional(Schema.String),
  beforeRun: Schema.optional(Schema.String),
  afterRun: Schema.optional(Schema.String),
  beforeRemove: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
}) {}

export class AgentConfig extends Schema.Class<AgentConfig>("AgentConfig")({
  maxConcurrentAgents: Schema.optional(Schema.Number),
  maxTurns: Schema.optional(Schema.Number),
  maxRetryBackoffMs: Schema.optional(Schema.Number),
  maxConcurrentAgentsByState: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Number }),
  ),
}) {}

export class AgentRuntimeConfig extends Schema.Class<AgentRuntimeConfig>("AgentRuntimeConfig")({
  command: Schema.optional(Schema.String),
  approvalPolicy: Schema.optional(Schema.String),
  turnTimeoutMs: Schema.optional(Schema.Number),
  readTimeoutMs: Schema.optional(Schema.Number),
  stallTimeoutMs: Schema.optional(Schema.Number),
}) {}

export class ServerConfig extends Schema.Class<ServerConfig>("ServerConfig")({
  port: Schema.optional(Schema.Number),
}) {}

export class WorkflowConfig extends Schema.Class<WorkflowConfig>("WorkflowConfig")({
  tracker: Schema.optional(TrackerConfig),
  polling: Schema.optional(PollingConfig),
  workspace: Schema.optional(WorkspaceConfig),
  hooks: Schema.optional(HooksConfig),
  agent: Schema.optional(AgentConfig),
  codex: Schema.optional(AgentRuntimeConfig),
  server: Schema.optional(ServerConfig),
}) {}

export class WorkflowDefinition extends Schema.Class<WorkflowDefinition>("WorkflowDefinition")({
  config: WorkflowConfig,
  promptTemplate: Schema.String,
}) {}
