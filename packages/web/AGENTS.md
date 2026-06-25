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

## Theme and primitives

- Call sites should use semantic classes or composed primitives, not long Tailwind strings.
- No arbitrary colors, typography, shadows, or spacing in JSX. Put them in `src/style.css` under a named Plot class.
- Tailwind utilities are acceptable inside primitive/component definitions, not scattered across feature call sites.
- Prefer coss primitives first. If a repeated Plot pattern appears, create a small composed component before adding more call-site classes.
- Extend `style.css` only for surfaced patterns. Do not create a token dump "for later".
- Use CSS variables for substrate values that third-party components need, e.g. React Flow grid colors.

## Product data flow

```text
fleet canvas: /api/sessions + SSE after registration.lastSequence
session detail: /api/sessions/:key/projection + SSE after projection.frontier
raw events: durable source of truth, not a default browser replay path
```

Keep fleet O(number of sessions), not O(total event log size).
