# AGENTS.md

## Scope

Applies to `packages/web/**`. Prefer this over root guidance when working on the React web app.

## Product stance

The web app is written for the operator who is _away_, not the one who is
watching. The default surface is the **Console** — Fleet rail, Masthead,
and Column — with no view switcher or board. Anything that makes the
dashboard demand attention it hasn't earned is a regression.

## Architecture

Keep the web app a clean React/TypeScript client over Plot's local file-backed gateway.

```text
api.ts               HTTP/SSE contract parsing, URLs, fetch helpers
main.tsx             app wiring only
app.tsx              run catalog, stream selection, projection loading, providers
fleet.tsx            Fleet rail, Fleet Brief home, zero state
derive-fleet.ts      pure run catalog + live projections -> ordered streams
masthead.tsx         selected stream sentence, meters, hold-to-stop
column.tsx           Column shell, Brief composition, hash-addressed inspector, scrub whisper
brief.tsx            composable Brief parts: headline, needs-you, running, coming up, outcomes
derive-brief.ts      pure projection -> BriefModel derivation
floor.tsx            pinned condensed timeline + scrub playhead
replay.ts            client replay fold/checkpoints over fetchable run events
palette.tsx          ⌘K overlay, keyboard navigation, command execution
commands.ts          pure command registry + fuzzy subsequence match
lanes.ts             pure projection -> lanes derivation used by derivations
board.tsx            shared shell fallbacks: BoardState, liveness, crash diagnostics
session-context.tsx  state/actions/meta context for the selected session, swaps active scrub projection
work-card.tsx        WorkCard helpers, glyphs, operator action parsing, hrefs
action-queue.ts      optimistic operator action queue, undo/retry state + provider
undo-rail.tsx        pending action toast stack with undo/retry
operator-zone.tsx    the one operator-action implementation: optimistic, hold-to-run, inline comments
use-queue-keys.ts    needs-you keyboard grammar (j/k/e/r/u/Enter), inert while scrubbing
inspector.tsx        work item detail: attempt timeline, streams, transcript
use-countdown.ts     1s clock/countdown helpers
use-last-seen.ts     "since you last looked" anchor (localStorage, per sessionId)
live-events.ts       live runRegistry delta hook
run.ts               runRegistry run DTO parsing
components/ui/*      copied coss primitives only when used
```

## React rules

- Use composition over boolean mode props. If a component wants `isDetail`, `isCompact`, `showFoo`, make explicit composed variants instead.
- Compound components with a shared context for multi-part surfaces (`WorkCard.*`, `Brief.*`); parts read the context, consumers compose the parts they need.
- Context values follow the `state` / `actions` / `meta` shape (see `session-context.tsx`); providers own data wiring, parts stay implementation-blind.
- Prefer small components with `children` slots over render props and giant configurable parents.
- Keep state ownership explicit: hooks/providers own data loading and mutation; presentational components receive ready data.
- Keep API parsing at the edge in `api.ts` / DTO modules. Views should not parse raw JSON.
- Derivations from the projection live in pure modules (`lanes.ts`, `derive-brief.ts`) with unit tests, never inline in components.
- React 19 idioms: `use()` not `useContext`, no `forwardRef`.
- Do not add global state libraries until prop flow is actually painful.
- Do not copy more coss components than are rendered.
- Operator actions have exactly one implementation (`operator-zone.tsx`). Never duplicate its action grammar.

## Theme and primitives

- Call sites should use semantic classes or composed primitives, not long Tailwind strings.
- No arbitrary colors, typography, shadows, or spacing in JSX. Put them in `src/style.css` under a named Plot class.
- Tailwind utilities are acceptable inside primitive/component definitions, not scattered across feature call sites.
- Prefer coss primitives first. If a repeated Plot pattern appears, create a small composed component before adding more call-site classes.
- Extend `style.css` only for surfaced patterns. Do not create a token dump "for later".
- Semantic color mapping is fixed: warning = needs-you, success = done, destructive = failed, info = running/new. Do not invent new meanings.

## Product data flow

```text
runRegistry catalog: /api/runs + SSE after run.lastSequence
fleet streams: workflowName + cwd, with live projection sweeps for live runs only
session detail: /api/runs/:id/projection + live SSE after projection.frontier
operator actions: optimistic client queue, 5s undo window, then recordObservation
raw events: /api/runs/:id/events is still live transport; scrub replay uses whatever records are fetchable and falls back without inventing server APIs
"since you last looked": client-only localStorage anchor per sessionId;
  written on pagehide/hidden, never while the operator is watching
```

Keep the catalog O(number of runs).
