# AGENTS.md

## Scope

Applies to `packages/web/**`. Prefer this over root guidance when working on the React web app.

## Architecture

Keep the web app a clean React/TypeScript client over Plot's local file-backed gateway.

```text
api.ts              HTTP/SSE contract parsing, URLs, fetch helpers
main.tsx           app wiring only
live-events.ts     live runRegistry delta hook
run.ts             runRegistry run DTO parsing
style.css          token-based .plot-* classes only
```

## React rules

- Use composition over boolean mode props. If a component wants `isDetail`, `isCompact`, `showFoo`, make explicit composed variants instead.
- Prefer small components with `children` slots over render props and giant configurable parents.
- Use compound components when a UI surface grows shared state across siblings.
- Keep state ownership explicit: hooks/providers own data loading and mutation; presentational components receive ready data.
- Keep API parsing at the edge in `api.ts` / DTO modules. Canvas/cards should not parse raw JSON.
- Plot UI remains normal React DOM/Astryx components.
- Do not add global state libraries until prop flow is actually painful.

## Theme and primitives

- Use `@astryxdesign/core` primitives first.
- Call sites should use semantic `.plot-*` classes or composed primitives, not long utility strings.
- No arbitrary colors, typography, shadows, or spacing in JSX. Put custom styling in `src/style.css` under named `.plot-*` classes using Astryx tokens.
- Extend `style.css` only for surfaced patterns. Do not create a token dump "for later".

## Product data flow

```text
runRegistry canvas: /api/runs + SSE after run.lastSequence
session detail: /api/runs/:id/projection + live SSE after projection.frontier
raw events: live transport only, never durable browser replay
```

Keep runRegistry O(number of runs).
