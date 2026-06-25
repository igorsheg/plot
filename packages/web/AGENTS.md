# AGENTS.md

## Scope

Applies to `packages/web/**`. Prefer this over root guidance when working on the React web app.

## Architecture

Keep the web app a clean React/TypeScript client over Plot's local file-backed gateway.

```text
api.ts              HTTP/SSE contract parsing, URLs, fetch helpers
main.tsx           app wiring only
flow-canvas.tsx    canvas substrate + composed node UI
live-events.ts     live fleet delta hook
registration.ts    registration DTO parsing
components/ui/*    copied coss primitives only when used
```

## React rules

- Use composition over boolean mode props. If a component wants `isDetail`, `isCompact`, `showFoo`, make explicit composed variants instead.
- Prefer small components with `children` slots over render props and giant configurable parents.
- Use compound components when a UI surface grows shared state across siblings.
- Keep state ownership explicit: hooks/providers own data loading and mutation; presentational components receive ready data.
- Keep API parsing at the edge in `api.ts` / DTO modules. Canvas/cards should not parse raw JSON.
- React Flow owns canvas mechanics only. Plot UI remains normal React DOM/coss/Tailwind components.
- Do not add global state libraries until prop flow is actually painful.
- Do not copy more coss components than are rendered.

## Product data flow

```text
fleet canvas: /api/sessions + SSE after registration.lastSequence
session detail: /api/sessions/:key/projection + SSE after projection.frontier
raw events: durable source of truth, not a default browser replay path
```

Keep fleet O(number of sessions), not O(total event log size).
