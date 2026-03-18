import { Schema } from "effect";

export const AgentEventType = Schema.Literals([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "auto_compaction_start",
  "auto_compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "notification"]);
export type AgentEventType = typeof AgentEventType.Type;

export class AgentRuntimeEvent extends Schema.Class<AgentRuntimeEvent>("AgentRuntimeEvent")({
  event: AgentEventType,
  timestamp: Schema.DateTimeUtc,
  agentPid: Schema.NullOr(Schema.String),
  issueId: Schema.String,
  issueIdentifier: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      inputTokens: Schema.Number,
      outputTokens: Schema.Number,
      totalTokens: Schema.Number,
    }),
  ),
  toolCallId: Schema.optional(Schema.String),
  toolName: Schema.optional(Schema.String),
  isError: Schema.optional(Schema.Boolean),
}) {}
