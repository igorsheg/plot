import { DateTime } from "effect";
import type { AgentRuntimeEvent } from "./schemas/events.js";

// --- Types ---

export interface TurnGroup {
  turnIndex: number;
  startedAt: DateTime.Utc;
  endedAt: DateTime.Utc | null;
  isActive: boolean;
  durationMs: number | null;
  events: AgentRuntimeEvent[];
}

export type Phase = "starting" | "working" | "tool_call" | "waiting" | "done" | "error";

// --- Constants ---

const TURN_BOUNDARY_EVENTS = new Set<string>([
  "turn_completed",
  "turn_failed",
  "turn_cancelled",
  "turn_ended_with_error",
  "turn_input_required",
]);

const PHASE_MAP: Record<string, Phase> = {
  session_started: "starting",
  startup_failed: "error",
  turn_completed: "done",
  turn_failed: "error",
  turn_cancelled: "done",
  turn_ended_with_error: "error",
  turn_input_required: "waiting",
  approval_auto_approved: "working",
  unsupported_tool_call: "tool_call",
  notification: "working",
  other_message: "working",
  malformed: "error",
};

// --- Event Type Labels & Colors ---

const EVENT_LABELS: Record<string, string> = {
  session_started: "session",
  startup_failed: "startup failed",
  turn_completed: "turn done",
  turn_failed: "turn failed",
  turn_cancelled: "cancelled",
  turn_ended_with_error: "error",
  turn_input_required: "input needed",
  approval_auto_approved: "auto-approved",
  unsupported_tool_call: "tool call",
  notification: "notice",
  other_message: "message",
  malformed: "malformed",
};

const EVENT_COLORS: Record<string, string> = {
  session_started: "text-info-foreground",
  startup_failed: "text-destructive-foreground",
  turn_completed: "text-success-foreground",
  turn_failed: "text-destructive-foreground",
  turn_cancelled: "text-muted-foreground",
  turn_ended_with_error: "text-destructive-foreground",
  turn_input_required: "text-warning-foreground",
  approval_auto_approved: "text-info-foreground",
  unsupported_tool_call: "text-chart-1",
  notification: "text-foreground",
  other_message: "text-muted-foreground",
  malformed: "text-destructive-foreground",
};

// --- Pure Functions ---

export function groupEventsByTurn(events: ReadonlyArray<AgentRuntimeEvent>): TurnGroup[] {
  if (events.length === 0) return [];

  const groups: TurnGroup[] = [];
  let currentEvents: AgentRuntimeEvent[] = [];
  let turnIndex = 0;

  for (const event of events) {
    currentEvents.push(event);

    if (TURN_BOUNDARY_EVENTS.has(event.event)) {
      const startedAt = currentEvents[0]!.timestamp;
      const endedAt = event.timestamp;
      groups.push({
        turnIndex,
        startedAt,
        endedAt,
        isActive: false,
        durationMs: Number(DateTime.toEpochMillis(endedAt)) - Number(DateTime.toEpochMillis(startedAt)),
        events: currentEvents,
      });
      currentEvents = [];
      turnIndex++;
    }
  }

  // remaining events form an active (in-progress) turn
  if (currentEvents.length > 0) {
    const startedAt = currentEvents[0]!.timestamp;
    groups.push({
      turnIndex,
      startedAt,
      endedAt: null,
      isActive: true,
      durationMs: null,
      events: currentEvents,
    });
  }

  return groups;
}

export function dedupNotifications(events: ReadonlyArray<AgentRuntimeEvent>): AgentRuntimeEvent[] {
  const seen = new Set<string>();
  const result: AgentRuntimeEvent[] = [];

  for (const event of events) {
    if (event.event === "notification" && event.message) {
      if (seen.has(event.message)) continue;
      seen.add(event.message);
    }
    result.push(event);
  }

  return result;
}

export function derivePhase(events: ReadonlyArray<AgentRuntimeEvent>): Phase {
  if (events.length === 0) return "starting";
  const last = events[events.length - 1]!;
  return PHASE_MAP[last.event] ?? "working";
}

export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

export function eventColor(eventType: string): string {
  return EVENT_COLORS[eventType] ?? "text-muted-foreground";
}

export function relativeTimestamp(event: AgentRuntimeEvent, origin: DateTime.Utc): string {
  const diffMs = Number(DateTime.toEpochMillis(event.timestamp)) - Number(DateTime.toEpochMillis(origin));
  if (diffMs < 1000) return "+0s";
  if (diffMs < 60_000) return `+${Math.round(diffMs / 1000)}s`;
  if (diffMs < 3_600_000) return `+${Math.round(diffMs / 60_000)}m`;
  return `+${Math.round(diffMs / 3_600_000)}h`;
}

export function isTerminalEvent(eventType: string): boolean {
  return TURN_BOUNDARY_EVENTS.has(eventType);
}
