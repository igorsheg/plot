import { describe, expect, test } from "bun:test";
import { DateTime } from "effect";
import { AgentRuntimeEvent } from "@plot/sdk";
import { appendToEventLog, clearEventLog, initialState } from "./orchestrator-state.js";

const makeEvent = (
  overrides: Partial<{
    event: AgentRuntimeEvent["event"];
    message: string | null;
    issueId: string;
    timestamp: number;
  }> = {},
) =>
  new AgentRuntimeEvent({
    event: overrides.event ?? "notification",
    timestamp: DateTime.makeUnsafe(overrides.timestamp ?? Date.now()),
    agentPid: null,
    issueId: overrides.issueId ?? "issue-1",
    issueIdentifier: "#1",
    sessionId: null,
    message: overrides.message ?? "hello",
  });

describe("appendToEventLog", () => {
  test("appends non-notification events normally", () => {
    let state = initialState;
    state = appendToEventLog(state, makeEvent({ event: "turn_start", message: null }));
    state = appendToEventLog(state, makeEvent({ event: "turn_end", message: null }));
    expect(state.eventLogs.get("issue-1")!.events).toHaveLength(2);
  });

  test("coalesces consecutive notifications into one entry", () => {
    let state = initialState;
    state = appendToEventLog(state, makeEvent({ message: "The " }));
    state = appendToEventLog(state, makeEvent({ message: "README " }));
    state = appendToEventLog(state, makeEvent({ message: "already has " }));
    state = appendToEventLog(state, makeEvent({ message: "extensive content." }));

    const events = state.eventLogs.get("issue-1")!.events;
    expect(events).toHaveLength(1);
    expect(events[0]!.message).toBe("The README already has extensive content.");
  });

  test("does not coalesce notifications across different issues", () => {
    let state = initialState;
    state = appendToEventLog(state, makeEvent({ issueId: "issue-1", message: "hello " }));
    state = appendToEventLog(state, makeEvent({ issueId: "issue-2", message: "world" }));

    expect(state.eventLogs.get("issue-1")!.events).toHaveLength(1);
    expect(state.eventLogs.get("issue-2")!.events).toHaveLength(1);
  });

  test("stops coalescing when a non-notification event interrupts", () => {
    let state = initialState;
    state = appendToEventLog(state, makeEvent({ message: "thinking " }));
    state = appendToEventLog(state, makeEvent({ message: "about it..." }));
    state = appendToEventLog(
      state,
      makeEvent({ event: "message_end", message: "thinking about it..." }),
    );
    state = appendToEventLog(state, makeEvent({ message: "now " }));
    state = appendToEventLog(state, makeEvent({ message: "doing stuff" }));

    const events = state.eventLogs.get("issue-1")!.events;
    expect(events).toHaveLength(3);
    expect(events[0]!.event).toBe("notification");
    expect(events[0]!.message).toBe("thinking about it...");
    expect(events[1]!.event).toBe("message_end");
    expect(events[2]!.event).toBe("notification");
    expect(events[2]!.message).toBe("now doing stuff");
  });

  test("updates timestamp to the latest chunk", () => {
    let state = initialState;
    state = appendToEventLog(state, makeEvent({ message: "a", timestamp: 1000 }));
    state = appendToEventLog(state, makeEvent({ message: "b", timestamp: 2000 }));

    const events = state.eventLogs.get("issue-1")!.events;
    expect(Number(DateTime.toEpochMillis(events[0]!.timestamp))).toBe(2000);
  });
});

describe("clearEventLog", () => {
  test("removes log for the given issue", () => {
    let state = initialState;
    state = appendToEventLog(state, makeEvent({ issueId: "issue-1" }));
    state = appendToEventLog(state, makeEvent({ issueId: "issue-2" }));
    state = clearEventLog(state, "issue-1");
    expect(state.eventLogs.has("issue-1")).toBe(false);
    expect(state.eventLogs.has("issue-2")).toBe(true);
  });
});
