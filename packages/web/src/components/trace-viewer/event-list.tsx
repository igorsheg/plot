import { useMemo } from "react";
import { useTraceViewer, matchesQuery } from "./root";
import { EventRow } from "./event-row";
import { GroupedEventList } from "./grouped-event-list";
import { StickToBottom } from "use-stick-to-bottom";
import type { AgentRuntimeEvent } from "@plot/sdk";

export function EventList() {
  const { state } = useTraceViewer();

  if (state.events.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="type-meta">no events yet</p>
      </div>
    );
  }

  return (
    <StickToBottom className="relative min-h-0 flex-1" resize="smooth" initial="smooth">
      <StickToBottom.Content>
        {state.viewMode === "grouped" ? <GroupedEventList /> : <RawEventList />}
      </StickToBottom.Content>
    </StickToBottom>
  );
}

function RawEventList() {
  const { state } = useTraceViewer();

  const filteredEvents = useMemo(() => {
    let result: readonly AgentRuntimeEvent[] = state.events;
    if (state.query) {
      result = result.filter((e) => matchesQuery(e, state.query));
    }
    if (state.typeFilter.size > 0) {
      result = result.filter((e) => state.typeFilter.has(e.event));
    }
    return result;
  }, [state.events, state.query, state.typeFilter]);

  if (filteredEvents.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="type-meta">no matching events</p>
      </div>
    );
  }

  return (
    <>
      {filteredEvents.map((event, i) => (
        <EventRow key={`${Number(event.timestamp)}-${i}`} event={event} />
      ))}
    </>
  );
}
