---
id: plot-6
identifier: PLOT-6
title: Add SSE connection status indicator to dashboard header
state: Todo
priority: 1
labels: [feature, web]
---

Add a visual connection status indicator to the plot dashboard header that shows whether the SSE event stream is connected, reconnecting, or disconnected.

## Context

The dashboard recently gained an SSE endpoint (`/rpc/events`) for real-time updates. The `useEventStream` hook in `packages/web/src/lib/use-event-stream.ts` connects via `EventSource`. Currently there's no visual feedback about the connection state — if SSE drops, the user has no idea.

## Requirements

1. **Extend `useEventStream` hook** (`packages/web/src/lib/use-event-stream.ts`):
   - Track connection status: `"connected" | "connecting" | "disconnected"`
   - Return `status` from the hook alongside `subscribe`
   - Set `"connecting"` on initial mount and on reconnect (`onerror`)
   - Set `"connected"` on first `onopen` event
   - Set `"disconnected"` only if the EventSource `readyState` is `CLOSED`

2. **Add connection indicator to `Dashboard.Header`** (`packages/web/src/components/dashboard.tsx`):
   - Show the SSE status next to the existing running/retrying counts
   - Use a small colored dot: green for connected, yellow/amber for connecting, red for disconnected
   - Show status text on hover using the existing `Tooltip` component
   - The connected dot should NOT pulse (the running indicator already pulses — two pulsing dots would be noisy)

3. **Thread status through context**:
   - Add the SSE status to `DashboardState` (or a new context field)
   - `Dashboard.Root` should pass it from `useEventStream()` into context
   - `Dashboard.Header` reads it from context

## Constraints

- Use existing UI components only (Badge, Tooltip, etc.)
- Follow the existing compound component pattern — no prop drilling
- No new dependencies
- Must pass `bun run typecheck` and `bun run lint` (0 errors)

## Acceptance criteria

- Header shows a dot that reflects real SSE connection state
- Hovering the dot shows "Connected", "Connecting...", or "Disconnected"
- Typecheck and lint pass with no new errors
