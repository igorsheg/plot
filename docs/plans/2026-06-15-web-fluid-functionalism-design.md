# Web Dashboard: Fluid Functionalism Overhaul

**Date:** 2026-06-15
**Package:** `packages/web` (`@plot/web`)
**Status:** Design approved, ready for implementation planning

## Goal

Make `packages/web` a full expression of the [Fluid Functionalism](https://github.com/mickadesign/fluid-functionalism)
design system on the [Base UI](https://base-ui.com) primitive, with client architecture
that conforms to the
[composition-patterns](https://github.com/vercel-labs/agent-skills/tree/main/skills/composition-patterns)
doctrine.

Hard constraint: **zero ad-hoc Tailwind tokens or one-off components.** Every visual
decision flows from an FF registry primitive. When something is missing, we define a
new primitive instead of inlining utilities.

Scope is all four dimensions the overhaul can touch: systematize and enforce, expand
the component library, conform the architecture, and redesign the screens.

## Starting point

The package already has an FF-shaped foundation:

- 8-level surface/elevation ladder, theme context (`T` key), shape context (`R` key),
  spring motion tokens.
- Seven compound components: `Button`, `Badge`, `Card`, `Disclosure`, `ListRow`,
  `Stat`, `Table` (cva + `cn()` + compound patterns).
- A single dashboard app with two views (Fleet, Session) driven by URL query params,
  fed by a WebSocket client to the Plot control plane (`@plot/control`).

The ad-hoc lives mostly in `app/dashboard/DashboardPage.tsx` (764 lines): local style
constants (`const accent = "text-amber-600 dark:text-amber-500"`), arbitrary type sizes
(`text-[12px]`, `text-[13px]`), a hand-rolled `StatusDot` with literal `bg-amber-500`,
and native `window.confirm` / `window.prompt` for operator confirmations.

## FF ingestion model

FF is a shadcn-style registry. Components install with:

```
npx shadcn@latest add https://www.fluidfunctionalism.com/r/<name>.json
```

FF ships **Base UI variants** of every primitive component, suffixed `-base`
(e.g. `button-base`, `dialog-base`). We standardize on Base UI (`@base-ui/react`, already
a dependency) as the single headless layer — a build-time decision, not a runtime toggle.
We never pull a Radix variant.

## Section 1 — Foundations: one source of truth

The FF control panel (Theme / Radius / Icons / Primitive) becomes ours:

| Panel control | Our implementation                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Theme         | existing `theme-context` (`T`). Keep.                                                                                                    |
| Radius        | existing `shape-context` (`R`). Keep.                                                                                                    |
| Icons         | **new**: ingest `icon-context` + `icon-map` (Lucide default, Tabler/Phosphor/HugeIcons switchable). Replaces raw `lucide-react` imports. |
| Primitive     | locked to Base UI. Not a runtime toggle.                                                                                                 |

Foundation items ingested from `/r/*.json` and reconciled against existing code:

| FF item                                                                               | Status                                               |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `surfaces` (theme)                                                                    | Have — verify `globals.css` matches upstream exactly |
| `springs`, `surface-context`, `surface-classes`, `elevated`, `shape-context`, `utils` | Have — diff and align to upstream                    |
| `font-weight` (Inter weight-animation tokens)                                         | New — enables FF's signature weight transitions      |
| `scroll-fade`                                                                         | New — scroll-edge gradient cues                      |
| `icon-context`, `icon-map`                                                            | New — icon abstraction                               |
| `use-proximity-hover`, `use-touch-primary`, `use-merge-split`                         | New — proximity hover + selection merge/split motion |

**Discipline rule:** anything not expressible through a primitive becomes a new defined
primitive, never inline utilities.

## Section 2 — Component library: the full FF kit on Base UI

Ingest Base UI variants: `button-base`, `switch-base`, `slider-base`, `tabs-base`,
`tooltip-base`, `dialog-base`, `accordion-base`, `checkbox-group-base`,
`radio-group-base`, `scroll-area-base`, plus `select` (Base UI).

Ingest unique components (no primitive variant): `badge`, `table`, `dropdown`,
`input-group`, `input-copy`, `input-message`, `tabs-subtle`, `thinking-indicator`,
`thinking-steps`, `file-thumbnail`.

**YAGNI cut** (do not ingest): `ask-user-questions`, `chat-message`, `color-picker` —
AI-chat surfaces irrelevant to an ops dashboard. Add later if a screen needs one.

**Reconcile, do not duplicate:**

- `Button`, `Badge`, `Table` — replace our versions with FF's, porting the props we
  depend on (Badge's 16-color palette, Button's `loading` / icon props) into the FF
  component. One canonical version each.
- `Disclosure` — keep as a thin, named single-panel composition over `accordion-base`,
  not a parallel implementation.
- `Card`, `ListRow`, `Stat` — not in FF; legitimate domain compounds. Keep, but rebuild
  strictly on FF tokens so they are indistinguishable from FF-native.

## Section 3 — Architecture conformance to composition-patterns

1. **Compose over configure (CRITICAL).** No boolean-prop proliferation, no monolithic
   flag-driven components. Multi-part components are compound families with shared
   context. Audit anywhere a screen passes a grab-bag of props to render variants.

2. **Lift state to providers (CRITICAL/HIGH).** Introduce a `DashboardProvider` exposing
   a clear context split: **state** (roster, projection, connection), **actions**
   (`sendCommand`, operator actions), **metadata** (controlRole, selection). Screens and
   rows read the slices they need via `use(Context)` instead of deep prop chains.

3. **Children over render props; explicit variants over flags (MEDIUM).** No `renderX`
   props — use `children` and slots. Split conditional-mode components into explicitly
   named variants (the doctrine's `ThreadComposer` / `EditComposer` example). Our
   `FleetSurface` / `SessionSurface` already follow this; extend it to smaller pieces
   (a "needs-you" row state becomes a distinct named composition, not a boolean flag).

**Decoupling rule:** domain/state logic (in `@plot/control` + the provider) stays
separate from UI. Presentational components receive data, render it, emit actions — no
fetching or WebSocket logic inside them.

## Section 4 — Screen redesign (Fleet + Session UX)

Decompose `DashboardPage.tsx` into `app/dashboard/` view files, each composing
primitives — no local style constants.

**Promote every one-off into a defined primitive:**

- `StatusDot` + `SessionState` → `StatusIndicator`: semantic `state` prop
  (working/blocked/failed/completed/paused), dot + label, motion-as-information (the dot
  animates on state transition via FF springs).
- `accent` / `text-[12px]` literals → type + tone tokens (FF `font-weight` scale + a
  `Text` primitive). The amber "needs you" accent becomes a named `--attention` token.
- `CodeLine` → FF `InputCopy` (click-to-copy the `plot tui …` commands).
- `Header`, `SectionTitle`, `NA` → `PageHeader`, `SectionLabel`, `EmptyValue`.

**Replace native prompts with FF overlays:**

- `window.confirm` (close session, danger actions) → FF `Dialog` with danger styling.
- `window.prompt` (operator-action comment) → FF `InputMessage` / `InputGroup` in dialog.
- `title=` disabled reasons → FF `Tooltip` ("controller required").

**Fleet view:** proximity-hover row highlighting (`use-proximity-hover`), merge-split
selection motion (`use-merge-split`), `scroll-fade` on table overflow. The raw "show
stopped" `<button>` becomes `TabsSubtle` (Active / All / Recently finished).

**Session view:** Pause/Resume becomes a `Switch` or segmented control; the inline
timeline stays a `Disclosure` (over `accordion-base`); the NeedsYou zone elevates via
`Elevated` + the `--attention` token.

## Section 5 — Testing & phased delivery

**Testing approach** (`bun test`, jsdom):

- **Primitive contracts:** each ingested/rebuilt primitive gets a render test asserting
  it reads `theme` / `shape` / `icon` context and exposes its compound parts. Structural
  and a11y (roles, `aria-*`, keyboard), not brittle visual snapshots.
- **Anti-ad-hoc lint gate:** an oxlint/regex check (or small test) that **fails on raw
  `text-[`, arbitrary color literals, and `window.confirm`/`prompt`** in `app/` and
  `components/`. Makes "zero ad-hoc" enforceable, not aspirational.
- **State provider:** test `DashboardProvider` context slices against the existing
  `mock-dashboard-state`.
- **Screens:** behavior tests (selecting a session, operator action opening a Dialog,
  controller-required disabling) using mock state — no WebSocket.

**Phased delivery** (each phase independently shippable, tests green, committed):

1. **Foundation** — ingest `font-weight`, `scroll-fade`, `icon-context`/`icon-map`, the
   three hooks; reconcile existing libs against upstream; add the icon toggle; add the
   anti-ad-hoc lint gate.
2. **Primitives** — ingest Base UI variants + unique components; reconcile
   Button/Badge/Table/Disclosure into single canonical FF versions; rebuild
   Card/ListRow/Stat on FF tokens.
3. **Architecture** — introduce `DashboardProvider` with the context split; convert
   screens to read context slices; split the monolith into view files.
4. **Screen redesign** — `StatusIndicator`, Dialog/InputMessage confirmations, Tooltip
   disabled-reasons, TabsSubtle filters, proximity-hover + merge-split + scroll-fade,
   Switch controls, refined header/empty states.

## Out of scope

- AI-chat components (`ask-user-questions`, `chat-message`, `color-picker`).
- Radix primitive variants.
- Multi-page routing beyond the current query-param Fleet/Session model.
