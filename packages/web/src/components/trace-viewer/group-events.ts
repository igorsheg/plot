import { DateTime } from "effect";
import type { AgentRuntimeEvent } from "@plot/sdk";

export interface ToolCallGroup {
  toolName: string;
  toolCallId?: string;
  startedAt: DateTime.Utc;
  endedAt?: DateTime.Utc;
  durationMs?: number;
  summary?: string;
  isError?: boolean;
  isActive: boolean;
  events: AgentRuntimeEvent[];
}

export interface TurnGroup {
  kind: "turn";
  turnIndex: number;
  startedAt: DateTime.Utc;
  endedAt?: DateTime.Utc;
  durationMs?: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  narration?: string;
  toolCalls: ToolCallGroup[];
  notifications: string[];
  events: AgentRuntimeEvent[];
  isActive: boolean;
}

export interface UngroupedSection {
  kind: "preamble" | "epilogue";
  events: AgentRuntimeEvent[];
}

export type EventGroup = TurnGroup | UngroupedSection;

function epochMs(dt: DateTime.Utc): number {
  return Number(DateTime.toEpochMillis(dt));
}

function makeTurn(turnIndex: number, startedAt: DateTime.Utc): TurnGroup {
  return {
    kind: "turn",
    turnIndex,
    startedAt,
    toolCalls: [],
    notifications: [],
    events: [],
    isActive: true,
  };
}

function makeToolCall(
  toolName: string,
  toolCallId: string | undefined,
  startedAt: DateTime.Utc,
): ToolCallGroup {
  return {
    toolName,
    toolCallId,
    startedAt,
    isActive: true,
    events: [],
  };
}

function findActiveToolCall(
  turn: TurnGroup,
  toolCallId: string | undefined,
): ToolCallGroup | undefined {
  if (toolCallId) {
    return turn.toolCalls.find((tc) => tc.toolCallId === toolCallId && tc.isActive);
  }
  for (let i = turn.toolCalls.length - 1; i >= 0; i--) {
    const tc = turn.toolCalls[i];
    if (tc && tc.isActive) return tc;
  }
  return undefined;
}

export function groupEventsIntoTurns(events: readonly AgentRuntimeEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  const preamble: AgentRuntimeEvent[] = [];
  let currentTurn: TurnGroup | null = null;
  let turnCounter = 0;
  let lastTurnEndIndex = -1;

  let idx = 0;
  for (const ev of events) {
    const i = idx++;

    switch (ev.event) {
      case "turn_start": {
        turnCounter++;
        currentTurn = makeTurn(turnCounter, ev.timestamp);
        currentTurn.events.push(ev);
        groups.push(currentTurn);
        break;
      }

      case "turn_end": {
        if (currentTurn) {
          currentTurn.events.push(ev);
          currentTurn.endedAt = ev.timestamp;
          currentTurn.durationMs = epochMs(ev.timestamp) - epochMs(currentTurn.startedAt);
          currentTurn.isActive = false;
          if (ev.usage) {
            currentTurn.tokenUsage = {
              inputTokens: ev.usage.inputTokens,
              outputTokens: ev.usage.outputTokens,
              totalTokens: ev.usage.totalTokens,
            };
          }
          for (const tc of currentTurn.toolCalls) {
            if (tc.isActive) {
              tc.isActive = false;
              tc.endedAt = ev.timestamp;
              tc.durationMs = epochMs(ev.timestamp) - epochMs(tc.startedAt);
            }
          }
          lastTurnEndIndex = i;
          currentTurn = null;
        }
        break;
      }

      case "tool_execution_start": {
        if (currentTurn) {
          const tc = makeToolCall(ev.toolName ?? "unknown", ev.toolCallId, ev.timestamp);
          tc.events.push(ev);
          currentTurn.toolCalls.push(tc);
          currentTurn.events.push(ev);
        }
        break;
      }

      case "tool_execution_update": {
        if (currentTurn) {
          const tc = findActiveToolCall(currentTurn, ev.toolCallId);
          if (tc) {
            tc.events.push(ev);
            if (ev.message) tc.summary = ev.message;
          }
          currentTurn.events.push(ev);
        }
        break;
      }

      case "tool_execution_end": {
        if (currentTurn) {
          const tc = findActiveToolCall(currentTurn, ev.toolCallId);
          if (tc) {
            tc.events.push(ev);
            tc.endedAt = ev.timestamp;
            tc.durationMs = epochMs(ev.timestamp) - epochMs(tc.startedAt);
            tc.isActive = false;
            tc.isError = ev.isError;
            if (ev.message) tc.summary = ev.message;
          }
          currentTurn.events.push(ev);
        }
        break;
      }

      case "auto_compaction_start":
      case "auto_retry_start": {
        if (currentTurn) {
          const name = ev.event === "auto_compaction_start" ? "compaction" : "retry";
          const tc = makeToolCall(name, undefined, ev.timestamp);
          tc.events.push(ev);
          currentTurn.toolCalls.push(tc);
          currentTurn.events.push(ev);
        }
        break;
      }

      case "auto_compaction_end":
      case "auto_retry_end": {
        if (currentTurn) {
          const name = ev.event === "auto_compaction_end" ? "compaction" : "retry";
          const tc = currentTurn.toolCalls.find((t) => t.toolName === name && t.isActive);
          if (tc) {
            tc.events.push(ev);
            tc.endedAt = ev.timestamp;
            tc.durationMs = epochMs(ev.timestamp) - epochMs(tc.startedAt);
            tc.isActive = false;
            if (ev.message) tc.summary = ev.message;
          }
          currentTurn.events.push(ev);
        }
        break;
      }

      case "message_start":
      case "message_update":
      case "message_end": {
        if (currentTurn) {
          if (ev.message && !currentTurn.narration) {
            currentTurn.narration = ev.message;
          }
          currentTurn.events.push(ev);
        } else {
          preamble.push(ev);
        }
        break;
      }

      case "notification": {
        if (currentTurn) {
          if (ev.message) {
            const isDupe =
              currentTurn.narration === ev.message ||
              currentTurn.notifications.includes(ev.message);
            if (!isDupe) {
              currentTurn.notifications.push(ev.message);
            }
          }
          currentTurn.events.push(ev);
        } else {
          preamble.push(ev);
        }
        break;
      }

      default: {
        if (currentTurn) {
          currentTurn.events.push(ev);
        } else {
          preamble.push(ev);
        }
        break;
      }
    }
  }

  if (preamble.length > 0) {
    groups.unshift({ kind: "preamble", events: preamble });
  }

  if (lastTurnEndIndex >= 0 && lastTurnEndIndex < events.length - 1) {
    const epilogueEvents: AgentRuntimeEvent[] = [];
    for (const ev of events.slice(lastTurnEndIndex + 1)) {
      if (ev.event === "turn_start") continue;
      const alreadyGrouped = groups.some((g) => g.kind === "turn" && g.events.includes(ev));
      if (!alreadyGrouped) {
        epilogueEvents.push(ev);
      }
    }
    if (epilogueEvents.length > 0) {
      groups.push({ kind: "epilogue", events: epilogueEvents });
    }
  }

  if (turnCounter === 0 && preamble.length === 0 && events.length > 0) {
    return [{ kind: "preamble", events: [...events] }];
  }

  return groups;
}

function matchesQuery(text: string | undefined | null, query: string): boolean {
  if (!text) return false;
  return text.toLowerCase().includes(query.toLowerCase());
}

export function filterGroups(
  groups: EventGroup[],
  query: string,
  typeFilter: Set<string>,
): EventGroup[] {
  if (!query && typeFilter.size === 0) return groups;

  const result: EventGroup[] = [];

  for (const group of groups) {
    if (group.kind === "turn") {
      const turnMatchesQuery =
        !query ||
        matchesQuery(group.narration, query) ||
        group.toolCalls.some(
          (tc) => matchesQuery(tc.toolName, query) || matchesQuery(tc.summary, query),
        ) ||
        group.notifications.some((n) => matchesQuery(n, query));

      if (!turnMatchesQuery) continue;

      if (typeFilter.size === 0) {
        result.push(group);
      } else {
        const filteredToolCalls = group.toolCalls.filter((tc) => typeFilter.has(tc.toolName));
        result.push({ ...group, toolCalls: filteredToolCalls });
      }
    } else {
      const filtered = group.events.filter((ev) => {
        const queryMatch =
          !query ||
          matchesQuery(ev.event, query) ||
          matchesQuery(ev.message, query) ||
          matchesQuery(ev.toolName, query);
        const typeMatch = typeFilter.size === 0 || typeFilter.has(ev.event);
        return queryMatch && typeMatch;
      });
      if (filtered.length > 0) {
        result.push({ ...group, events: filtered });
      }
    }
  }

  return result;
}
