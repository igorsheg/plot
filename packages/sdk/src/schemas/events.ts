import { Schema } from "effect";

export const AgentEventType = Schema.Literal(
  "session_started",
  "startup_failed",
  "turn_completed",
  "turn_failed",
  "turn_cancelled",
  "turn_ended_with_error",
  "turn_input_required",
  "approval_auto_approved",
  "unsupported_tool_call",
  "notification",
  "other_message",
  "malformed",
);
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
  phase: Schema.optional(Schema.String),
  activeTools: Schema.optional(Schema.Array(Schema.String)),
  lastAssistantMessage: Schema.optional(Schema.NullOr(Schema.String)),
}) {}
