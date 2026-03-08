import { describe, expect, test } from "bun:test";
import { DateTime } from "effect";
import { AgentRuntimeEvent } from "./schemas/events.js";
import {
  groupEventsByTurn,
  dedupNotifications,
  derivePhase,
  eventLabel,
  eventColor,
  relativeTimestamp,
  isTerminalEvent,
} from "./trace-grouping.js";

function makeEvent(
  event: string,
  offsetMs: number,
  message?: string,
): AgentRuntimeEvent {
  const base = 1700000000000;
  return new AgentRuntimeEvent({
    event: event as AgentRuntimeEvent["event"],
    timestamp: DateTime.unsafeMake(base + offsetMs),
    agentPid: "pid-1",
    issueId: "issue-1",
    issueIdentifier: "#1",
    sessionId: "sess-1",
    message: message ?? null,
  });
}

describe("groupEventsByTurn", () => {
  test("empty events → empty groups", () => {
    expect(groupEventsByTurn([])).toEqual([]);
  });

  test("single completed turn", () => {
    const events = [
      makeEvent("session_started", 0),
      makeEvent("notification", 1000, "doing stuff"),
      makeEvent("turn_completed", 5000),
    ];
    const groups = groupEventsByTurn(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.turnIndex).toBe(0);
    expect(groups[0]!.isActive).toBe(false);
    expect(groups[0]!.durationMs).toBe(5000);
    expect(groups[0]!.events).toHaveLength(3);
  });

  test("multiple turns", () => {
    const events = [
      makeEvent("session_started", 0),
      makeEvent("turn_completed", 3000),
      makeEvent("notification", 4000, "next turn"),
      makeEvent("turn_completed", 8000),
    ];
    const groups = groupEventsByTurn(events);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.turnIndex).toBe(0);
    expect(groups[1]!.turnIndex).toBe(1);
    expect(groups[0]!.isActive).toBe(false);
    expect(groups[1]!.isActive).toBe(false);
  });

  test("trailing events form active turn", () => {
    const events = [
      makeEvent("session_started", 0),
      makeEvent("turn_completed", 3000),
      makeEvent("notification", 5000, "working..."),
    ];
    const groups = groupEventsByTurn(events);
    expect(groups).toHaveLength(2);
    expect(groups[1]!.isActive).toBe(true);
    expect(groups[1]!.durationMs).toBeNull();
    expect(groups[1]!.endedAt).toBeNull();
  });

  test("failed turn is boundary", () => {
    const events = [
      makeEvent("session_started", 0),
      makeEvent("turn_failed", 2000),
    ];
    const groups = groupEventsByTurn(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.isActive).toBe(false);
  });
});

describe("dedupNotifications", () => {
  test("removes duplicate notification messages", () => {
    const events = [
      makeEvent("notification", 0, "hello"),
      makeEvent("notification", 1000, "hello"),
      makeEvent("notification", 2000, "world"),
      makeEvent("notification", 3000, "hello"),
    ];
    const result = dedupNotifications(events);
    expect(result).toHaveLength(2);
    expect(result[0]!.message).toBe("hello");
    expect(result[1]!.message).toBe("world");
  });

  test("preserves non-notification events", () => {
    const events = [
      makeEvent("session_started", 0),
      makeEvent("turn_completed", 1000),
      makeEvent("turn_completed", 2000),
    ];
    const result = dedupNotifications(events);
    expect(result).toHaveLength(3);
  });

  test("notifications without messages are kept", () => {
    const events = [
      makeEvent("notification", 0),
      makeEvent("notification", 1000),
    ];
    const result = dedupNotifications(events);
    expect(result).toHaveLength(2);
  });
});

describe("derivePhase", () => {
  test("empty events → starting", () => {
    expect(derivePhase([])).toBe("starting");
  });

  test("session_started → starting", () => {
    expect(derivePhase([makeEvent("session_started", 0)])).toBe("starting");
  });

  test("notification → working", () => {
    expect(derivePhase([makeEvent("notification", 0, "hi")])).toBe("working");
  });

  test("turn_completed → done", () => {
    expect(derivePhase([makeEvent("turn_completed", 0)])).toBe("done");
  });

  test("turn_failed → error", () => {
    expect(derivePhase([makeEvent("turn_failed", 0)])).toBe("error");
  });

  test("unsupported_tool_call → tool_call", () => {
    expect(derivePhase([makeEvent("unsupported_tool_call", 0)])).toBe("tool_call");
  });

  test("turn_input_required → waiting", () => {
    expect(derivePhase([makeEvent("turn_input_required", 0)])).toBe("waiting");
  });

  test("uses last event", () => {
    const events = [
      makeEvent("session_started", 0),
      makeEvent("notification", 1000, "working"),
      makeEvent("turn_failed", 2000),
    ];
    expect(derivePhase(events)).toBe("error");
  });
});

describe("eventLabel", () => {
  test("known types", () => {
    expect(eventLabel("session_started")).toBe("session");
    expect(eventLabel("turn_completed")).toBe("turn done");
    expect(eventLabel("unsupported_tool_call")).toBe("tool call");
  });

  test("unknown type returns raw", () => {
    expect(eventLabel("unknown_type")).toBe("unknown_type");
  });
});

describe("eventColor", () => {
  test("known types return tailwind class", () => {
    expect(eventColor("session_started")).toBe("text-info-foreground");
    expect(eventColor("turn_failed")).toBe("text-destructive-foreground");
  });

  test("unknown type returns muted", () => {
    expect(eventColor("whatever")).toBe("text-muted-foreground");
  });
});

describe("relativeTimestamp", () => {
  test("sub-second → +0s", () => {
    const origin = DateTime.unsafeMake(1700000000000);
    const event = makeEvent("notification", 500);
    expect(relativeTimestamp(event, origin)).toBe("+0s");
  });

  test("seconds", () => {
    const origin = DateTime.unsafeMake(1700000000000);
    const event = makeEvent("notification", 15000);
    expect(relativeTimestamp(event, origin)).toBe("+15s");
  });

  test("minutes", () => {
    const origin = DateTime.unsafeMake(1700000000000);
    const event = makeEvent("notification", 120_000);
    expect(relativeTimestamp(event, origin)).toBe("+2m");
  });

  test("hours", () => {
    const origin = DateTime.unsafeMake(1700000000000);
    const event = makeEvent("notification", 7_200_000);
    expect(relativeTimestamp(event, origin)).toBe("+2h");
  });
});

describe("isTerminalEvent", () => {
  test("boundary events are terminal", () => {
    expect(isTerminalEvent("turn_completed")).toBe(true);
    expect(isTerminalEvent("turn_failed")).toBe(true);
    expect(isTerminalEvent("turn_cancelled")).toBe(true);
    expect(isTerminalEvent("turn_ended_with_error")).toBe(true);
    expect(isTerminalEvent("turn_input_required")).toBe(true);
  });

  test("non-boundary events are not terminal", () => {
    expect(isTerminalEvent("session_started")).toBe(false);
    expect(isTerminalEvent("notification")).toBe(false);
    expect(isTerminalEvent("unsupported_tool_call")).toBe(false);
    expect(isTerminalEvent("other_message")).toBe(false);
  });
});

describe("groupEventsByTurn edge cases", () => {
  test("single event without boundary is active turn", () => {
    const events = [makeEvent("session_started", 0)];
    const groups = groupEventsByTurn(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.isActive).toBe(true);
    expect(groups[0]!.turnIndex).toBe(0);
  });

  test("consecutive boundary events create single-event turns", () => {
    const events = [
      makeEvent("turn_completed", 0),
      makeEvent("turn_failed", 1000),
    ];
    const groups = groupEventsByTurn(events);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.events).toHaveLength(1);
    expect(groups[1]!.events).toHaveLength(1);
  });

  test("duration is computed correctly across turns", () => {
    const events = [
      makeEvent("session_started", 0),
      makeEvent("notification", 500, "quick"),
      makeEvent("turn_completed", 2500),
    ];
    const groups = groupEventsByTurn(events);
    expect(groups[0]!.durationMs).toBe(2500);
  });
});
