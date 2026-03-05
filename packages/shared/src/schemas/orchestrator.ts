import { Schema } from "effect";
import { AgentRuntimeEvent } from "./events.js";

export const RunStatus = Schema.Literal(
  "PreparingWorkspace",
  "BuildingPrompt",
  "LaunchingAgentProcess",
  "InitializingSession",
  "StreamingTurn",
  "Finishing",
  "Succeeded",
  "Failed",
  "TimedOut",
  "Stalled",
  "CanceledByReconciliation",
);
export type RunStatus = typeof RunStatus.Type;

export class LiveSession extends Schema.Class<LiveSession>("LiveSession")({
  sessionId: Schema.String,
  threadId: Schema.String,
  turnId: Schema.String,
  agentPid: Schema.NullOr(Schema.String),
  lastEvent: Schema.NullOr(Schema.String),
  lastEventAt: Schema.NullOr(Schema.DateTimeUtc),
  lastMessage: Schema.NullOr(Schema.String),
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalTokens: Schema.Number,
  turnCount: Schema.Number,
}) {}

export class RunningEntry extends Schema.Class<RunningEntry>("RunningEntry")({
  issueId: Schema.String,
  issueIdentifier: Schema.String,
  state: Schema.String,
  startedAt: Schema.DateTimeUtc,
  workspacePath: Schema.NullOr(Schema.String),
  session: LiveSession,
}) {}

export class RetryEntry extends Schema.Class<RetryEntry>("RetryEntry")({
  issueId: Schema.String,
  identifier: Schema.String,
  attempt: Schema.Number,
  dueAt: Schema.DateTimeUtc,
  error: Schema.NullOr(Schema.String),
}) {}

export class TokenTotals extends Schema.Class<TokenTotals>("TokenTotals")({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalTokens: Schema.Number,
  secondsRunning: Schema.Number,
}) {}

export class RuntimeSnapshot extends Schema.Class<RuntimeSnapshot>("RuntimeSnapshot")({
  generatedAt: Schema.DateTimeUtc,
  counts: Schema.Struct({
    running: Schema.Number,
    retrying: Schema.Number,
  }),
  running: Schema.Array(RunningEntry),
  retrying: Schema.Array(RetryEntry),
  codexTotals: TokenTotals,
  rateLimits: Schema.NullOr(Schema.Unknown),
}) {}

export class IssueDetail extends Schema.Class<IssueDetail>("IssueDetail")({
  issueIdentifier: Schema.String,
  issueId: Schema.String,
  status: Schema.String,
  workspacePath: Schema.NullOr(Schema.String),
  running: Schema.NullOr(RunningEntry),
  retry: Schema.NullOr(RetryEntry),
  lastError: Schema.NullOr(Schema.String),
  eventTail: Schema.Array(AgentRuntimeEvent),
}) {}
