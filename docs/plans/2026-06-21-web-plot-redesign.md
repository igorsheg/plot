# Plot Web Redesign — Triage Lobby ↔ Session Room

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fleet-sidebar + session-surface shell with a layered model — a cross-fleet **Triage Lobby** (centered column, default landing) that zooms into a per-session **Session Room** (two-pane), governed by one accent rule ("monochrome = autonomous & fine; the single accent = a human is needed").

**Architecture:** Keep the existing coss design system, Inter/Berkeley Mono, the `dashboard-context` state/actions/meta slices, the `@plot/control` projection model, and the `layout.tsx` primitive kit. The handoff (`docs/design_handoff_plot_redesign/`) is the **layout/interaction spec**, not a re-skin — its warm-paper/burnt-orange/JetBrains aesthetic is set aside. Two routes: `/` (Lobby) and `/session/$sessionId` (Room). The Lobby renders from **roster summaries only** (no transport change); real operator actions / `blockedReason` live in the Room, which attaches the full projection.

**Tech Stack:** React 19, TanStack Router, Base UI (coss `ui/` primitives), Tailwind v4 (`@theme` tokens in `globals.css`), `motion`, `bun:test` + `renderToStaticMarkup`.

**Reference reading before starting:**

- `docs/design_handoff_plot_redesign/README.md` — the design spec (screens, data mapping, edge states).
- `packages/web/src/app/dashboard/views/layout.tsx` — the primitive kit (`Stack`/`Row`/`Meta`/`MetaButton`/`SectionLabel`/`Rail`). **Never add ad-hoc spacing/type in views — extend this kit.**
- `packages/web/src/app/dashboard/views/session-surface.tsx` — the current room; harvest `useNow`, `useEsc`, `dashboardModelFrom` usage, spring tiers, `oneLine`, `rowAge`, `Trail`, `PulseHeader`, `SessionControls`. **This file is the source of most reusable view code.**
- `packages/web/src/app/dashboard/views/operator-actions.tsx` — the operator-action button + its confirm/comment Dialog. Reused almost verbatim in the Room.

## Locked decisions (do not re-litigate)

1. **Tokens:** keep coss + Inter/Berkeley Mono. Handoff = layout/IX spec only.
2. **Accent:** exactly one semantic color. `--attention` IS the single "needs-you" accent. `--live` → ink (motion carries liveness). `--destructive` aliases to `--attention` (danger folds into the accent). No blue, no red on the product surface.
3. **Shell:** full Lobby↔Room. Retire `app-sidebar.tsx`, `fleet-rail.tsx`, the `SidebarProvider` shell. The coss `ui/sidebar.tsx` _primitive_ stays in the library (unused, not deleted).
4. **Lobby data:** roster summaries only. NEEDS YOU rows route INTO the Room. No fleet-wide multi-attach.
5. **needsYouCount semantics (edge-state #8):** a NEEDS YOU session = `summary.needsYouCount > 0`. Badge and section both use this count, consistently.
6. **Accent discipline (edge-state #6):** ATTENTION (diagnostics/stale) renders **neutral ink**. The accent is reserved for actionable NEEDS YOU only.
7. **Phasing:** DS layer → Lobby → Room+dialog → edge states.

---

## Phase 0 — Branch & baseline

### Task 0.1: Confirm branch and green baseline

**Step 1:** Confirm you are on `refactor/web-plot-redesign`.

Run: `git -C packages/web rev-parse --abbrev-ref HEAD` (from repo root: `git branch --show-current`)
Expected: `refactor/web-plot-redesign`

**Step 2:** Establish the baseline is green before touching anything.

Run: `cd packages/web && bun test && bun run typecheck && bun run lint`
Expected: all pass. If not, STOP and report — do not build on a red baseline.

**Step 3:** Commit nothing yet (no changes). Proceed to Phase 1.

---

## Phase 1 — Design-system delta (the one-accent rule)

The bones of `globals.css` and `layout.tsx` are good. These edits are surgical: collapse three semantic colors to one, demote `--live` to ink, fold danger into the accent, and add the two tint tokens the Lobby/Room accent surfaces need.

### Task 1.1: Collapse semantic colors to one accent in `globals.css`

**Files:**

- Modify: `packages/web/src/globals.css`

**Step 1: Edit `:root` (light) Plot product tokens.**

Replace the light-mode Plot product token block (currently lines ~79–86):

```css
/* Plot product tokens — the single accent + neutral data tones.
	   ONE accent rule: monochrome = autonomous & fine; --attention is the only
	   chromatic token and means "a human is needed". Live is ink + motion. */
--selected: --alpha(var(--color-black) / 6%);
--hover: --alpha(var(--color-black) / 4%);
--active: --alpha(var(--color-black) / 8%);
--attention: var(--color-amber-600);
--attention-soft: --alpha(var(--color-amber-600) / 5%);
--attention-border: --alpha(var(--color-amber-600) / 22%);
--t3: var(--color-neutral-400);
/* Live is no longer chromatic — it resolves to ink so liveness reads through
	   motion (pulse-beat / shimmer-text), not hue. Token kept so callsites that
	   reference --live/-bg-live keep working through the sweep. */
--live: var(--foreground);
/* Danger folds into the one accent: a danger action still means "a human is
	   involved". Kept as an alias so coss components referencing --destructive
	   render in the accent, not red. */
--destructive: var(--attention);
--destructive-foreground: var(--attention);
```

**Step 2: Edit `.dark` Plot product tokens.**

Replace the dark-mode Plot product token block (currently lines ~143–149):

```css
/* Plot product tokens (dark) — same one-accent rule. */
--selected: --alpha(var(--color-white) / 6%);
--hover: --alpha(var(--color-white) / 4%);
--active: --alpha(var(--color-white) / 8%);
--attention: var(--color-amber-400);
--attention-soft: --alpha(var(--color-amber-400) / 6%);
--attention-border: --alpha(var(--color-amber-400) / 24%);
--t3: var(--color-neutral-500);
--live: var(--foreground);
--destructive: var(--attention);
--destructive-foreground: var(--attention);
```

> Note: `--destructive` was previously `var(--color-red-500)`; the coss base also sets `--destructive` near the top of `:root`/`.dark`. Override it in the Plot product block (which comes _after_), so the Plot value wins. Leave the coss base lines intact.

**Step 3: Register the two new tint tokens in `@theme inline`.**

After the existing `--color-attention: var(--attention);` line (~198), add:

```css
--color-attention-soft: var(--attention-soft);
--color-attention-border: var(--attention-border);
```

**Step 4: Verify the build still compiles.**

Run: `cd packages/web && bun run build`
Expected: build succeeds (Tailwind resolves the new `--color-attention-soft`/`-border` utilities `bg-attention-soft`, `border-attention-border`).

**Step 5: Commit.**

```bash
git add packages/web/src/globals.css
git commit -m "refactor(web): collapse to one accent, ink-only live"
```

### Task 1.2: Add Rail/Meta tones the redesign needs in `layout.tsx`

**Files:**

- Modify: `packages/web/src/app/dashboard/views/layout.tsx`

**Step 1: Extend `RailTone` and `railTone` map.**

The handoff's work-list rail wants: resolved→`line-strong`, stale→`line-strong`, blocked/failed→accent, running→ink, else→muted. Map onto the kit. Replace the `RailTone` type + `railTone` map:

```ts
export type RailTone =
	| "attention" // blocked/failed — the one accent
	| "live" // running — ink (motion conveys liveness)
	| "border" // idle/default
	| "resolved" // done/stale — a settled stroke
	| "outline";

const railTone: Record<RailTone, string> = {
	attention: "bg-attention",
	live: "bg-foreground",
	border: "bg-border",
	resolved: "bg-border", // line-strong equivalent in the neutral ramp
	outline: "bg-transparent shadow-[inset_0_0_0_1px_var(--color-border)]",
};
```

> `live` was `bg-live`; with `--live` now = foreground they are equal, but use `bg-foreground` directly so the intent (ink, not a color) is explicit.

**Step 2: Add an `accent` tone to `SectionLabel`.**

The NEEDS YOU section label is the accent; every other label is `t3`. Add a `tone` prop:

```tsx
export function SectionLabel({
	children,
	count,
	tone = "default",
	className,
}: {
	children: ReactNode;
	count?: number;
	tone?: "default" | "accent";
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex items-baseline justify-between font-mono text-2xs uppercase tracking-wider",
				tone === "accent" ? "text-attention" : "text-t3",
				className,
			)}
		>
			<span>{children}</span>
			{count === undefined ? null : (
				<span className="tabular-nums">{count}</span>
			)}
		</div>
	);
}
```

> The handoff calls for section labels uppercase + tracked. `uppercase tracking-wider` are layout utilities owned by this primitive (not ad-hoc type — no `text-[..]`). Verify existing callsites still read well; if any pass already-uppercase text, lowercase the source string.

**Step 3:** `Meta` tone `live` already maps to `text-live`; with `--live` = foreground it now renders ink. No change needed, but confirm `text-live` resolves (it does — `--color-live` is registered).

**Step 4: Typecheck.**

Run: `cd packages/web && bun run typecheck`
Expected: PASS (no callsite passes a removed RailTone; `live`/`border`/`attention`/`outline` all still exist).

**Step 5: Commit.**

```bash
git add packages/web/src/app/dashboard/views/layout.tsx
git commit -m "refactor(web): extend Rail/SectionLabel tones for redesign"
```

### Task 1.3: Sweep the `bg-live` / blue-live callsites to ink

**Files:**

- Modify: `packages/web/src/app/dashboard/views/session-surface.tsx` (lines ~211–212, 388)
- Grep first: `rg -n "bg-live|text-live|bg-live/5|tone=\"live\"" packages/web/src`

**Step 1:** For each `bg-live` (the pulse dot) leave as-is functionally (it resolves to ink now), but for readability replace `bg-live` → `bg-foreground` and `bg-live/5` → `bg-foreground/5` in `session-surface.tsx`. (This file is largely replaced in Phase 3; this keeps the interim state coherent.)

**Step 2: Typecheck + test.**

Run: `cd packages/web && bun run typecheck && bun test`
Expected: PASS (the `offline · last frame` and operator-action tests still pass — tone changes don't alter asserted text).

**Step 3: Commit.**

```bash
git add packages/web/src
git commit -m "refactor(web): live dots read as ink, not blue"
```

---

## Phase 2 — Routing inversion + Triage Lobby

The index route becomes the Lobby (no auto-dive, except the single-reachable-session convenience). The Lobby is a centered column built from roster summaries.

### Task 2.1: Build the Triage Lobby view (summary-only)

**Files:**

- Create: `packages/web/src/app/dashboard/views/triage-lobby.tsx`
- Reference: `app-sidebar.tsx` (roster rendering, `connectionDot`, `toneForSession`), `fleet-model.ts` (`sortPlotSessions`), `session-surface.tsx` (`useNow`).

**Step 1: Write the lobby.** Build top-to-bottom with the layout kit. Sections derive from summaries via `sortPlotSessions(roster)` then partition by state/needsYouCount. Complete skeleton:

```tsx
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/sparkline";
import { StatusDot } from "@/components/ui/status-indicator";
import { cn } from "@/lib/utils";
import { useDashboardMeta, useDashboardState } from "../dashboard-context";
import { sortPlotSessions, visibleFleetSessions } from "../fleet-model";
import { sessionIsRunning, toneForSession } from "./status";
import { Meta, MetaButton, Rail, Row, SectionLabel, Stack } from "./layout";

// Connection → label (reused from app-sidebar's connectionDot; move to status.tsx
// in Task 2.3 so both the Lobby chrome and Room degraded look share it).
import { connectionLabel } from "./status";

const sessionLinkProps = (id: string) => ({
	to: "/session/$sessionId" as const,
	params: { sessionId: id },
	search: (prev: { role?: "observer" | "controller" }) => ({
		role: prev.role ?? "controller",
	}),
});

export function TriageLobby() {
	const { roster, connection } = useDashboardState();
	const { controlRole } = useDashboardMeta();
	const sessions = visibleFleetSessions(roster, false);

	const needsYou = sessions.filter((s) => s.needsYouCount > 0);
	const acting = sessions.filter(
		(s) => s.needsYouCount === 0 && sessionIsRunning(s),
	);
	const watching = sessions.filter(
		(s) => s.needsYouCount === 0 && !sessionIsRunning(s),
	);
	const needsYouTotal = needsYou.reduce((n, s) => n + s.needsYouCount, 0);

	return (
		<Stack
			gap={6}
			className="mx-auto w-full max-w-[1080px] px-gutter pb-20 pt-6"
		>
			<LobbyChrome
				connection={connection}
				controlRole={controlRole}
				sessionCount={sessions.length}
			/>

			{needsYou.length > 0 ? (
				<Card className="border-attention-border bg-attention-soft p-0">
					<div className="px-4 pt-4">
						<SectionLabel tone="accent" count={needsYouTotal}>
							needs you
						</SectionLabel>
					</div>
					<Stack gap={0} className="pt-2">
						{needsYou.map((s) => (
							<NeedsYouRow key={s.id} session={s} />
						))}
					</Stack>
				</Card>
			) : null}

			{acting.length > 0 ? (
				<Stack gap={2}>
					<SectionLabel count={acting.length}>
						acting · self-driving
					</SectionLabel>
					{acting.map((s) => (
						<ActingRow key={s.id} session={s} />
					))}
				</Stack>
			) : null}

			{watching.length > 0 ? (
				<Stack gap={2}>
					<SectionLabel count={watching.length}>
						watching · scheduled
					</SectionLabel>
					{watching.map((s) => (
						<WatchingRow key={s.id} session={s} />
					))}
				</Stack>
			) : null}

			{sessions.length === 0 ? <EmptyFleet connection={connection} /> : null}

			<Meta className="pt-2">
				⌘K to jump · operator actions record an observation back into the Plot
				loop.
			</Meta>
		</Stack>
	);
}
```

Implement the row sub-components below it. Each row is a `Link` styled with the kit (NOT a coss Button):

- `NeedsYouRow`: `grid-cols-[3px_minmax(0,1fr)_auto]`, `Rail tone="attention"`, `workflowName` (Label role: `text-sm font-medium`), right `Meta` = `{workflowName} · {cwdName}` → actually right `Meta` = `cwdName`; a `Meta tone="attention"` count badge of `needsYouCount`; trailing `open →` (`ArrowRight size={14}`). Hover `bg-hover`. **No operator-action buttons** (those are in the Room).
- `ActingRow`: live dot (`pulse-beat`, ink) · `workflowName` · `Meta` = `cwdName` · right `agents.active/max` + `tok/s` from `tokenThroughputPerSecond` (use `formatTokens`-style; throughput is a number → render `{n} tok/s` or `—`). No per-run activity shimmer (no projection at fleet level — honest to summary-only).
- `WatchingRow`: glyph `○` (watching/idle) or `↻` (reconciling/retry) · `workflowName` · `Meta` subtitle = `cwdName`.
- `LobbyChrome`: `Row` justify-between. Left: ink live dot + `plot` wordmark (`text-sm font-medium`) + connection `StatusDot` + `connectionLabel(connection)` + role toggle (`RoleToggle`, Task 2.2) + session count `Meta`. Right: omit the fleet throughput sparkline for now (no fleet-wide token series in summaries) OR sum `tokenThroughputPerSecond` across `acting` and render `{sum} tok/s`. Keep it summary-honest.
- `EmptyFleet`: a `Stack` with `Meta` — "No sessions yet." / connection-aware copy (`handoff-missing` → "Local Plot Server handoff was not provided.").

**Step 2: Write the failing test.** Add to `test/dashboard-import.test.tsx` (or a new `test/triage-lobby.test.tsx` with the same harness). Mirror the existing `state()`/`summary()` builders.

```tsx
test("lobby groups sessions into needs-you / acting / watching", () => {
	const html = renderLobby(
		state({
			roster: [
				summary({ id: "blocked", workflowName: "review", needsYouCount: 2 }),
				summary({
					id: "busy",
					workflowName: "build",
					state: "acting",
					agents: { active: 1, max: 4 },
				}),
				summary({ id: "calm", workflowName: "docs", state: "watching" }),
			],
		}),
	);
	expect(html).toContain("needs you");
	expect(html).toContain("review");
	expect(html).toContain("acting");
	expect(html).toContain("build");
	expect(html).toContain("watching");
	expect(html).toContain("docs");
});
```

Where `renderLobby` renders `<DashboardProvider state={...}><TriageLobby /></DashboardProvider>` via `renderToStaticMarkup`.

**Step 3: Run test to verify it fails (red).**

Run: `cd packages/web && bun test test/dashboard-import.test.tsx`
Expected: FAIL ("Cannot find module triage-lobby" or assertion fail) before the view exists.

**Step 4:** Implement until green.

Run: `cd packages/web && bun test test/dashboard-import.test.tsx`
Expected: PASS.

**Step 5: Commit.**

```bash
git add packages/web/src/app/dashboard/views/triage-lobby.tsx packages/web/test
git commit -m "feat(web): add Triage Lobby view (summary-only)"
```

### Task 2.2: Role toggle + connection label helpers in `status.tsx`

**Files:**

- Modify: `packages/web/src/app/dashboard/views/status.tsx` (currently 31 lines — `sessionIsRunning`, `toneForSession`)

**Step 1:** Add `connectionLabel(connection)` (lift the `connectionDot` label map out of `app-sidebar.tsx` so it survives the sidebar's deletion). Add a `RoleToggle` component — a `MetaButton` showing `controller`/`observer` with `⇅`, navigating with `search: (prev) => ({ role: prev.role === "observer" ? "controller" : "observer" })` via `useNavigate`. Reads `controlRole` from `useDashboardMeta`.

**Step 2:** Typecheck + test.

Run: `cd packages/web && bun run typecheck && bun test`
Expected: PASS.

**Step 3: Commit.**

```bash
git add packages/web/src/app/dashboard/views/status.tsx
git commit -m "feat(web): role toggle + connection label helpers"
```

### Task 2.3: Invert the index route to the Lobby, retire the sidebar shell

**Files:**

- Modify: `packages/web/src/router.tsx`
- Delete (Task 4.x, after green): `app-sidebar.tsx`, `fleet-rail.tsx`

**Step 1:** Rewrite `RootLayout` to drop `SidebarProvider`/`AppSidebar`/`SidebarInset`. The root becomes a plain scroll container; each route owns its own width (Lobby centers itself, Room is full-bleed):

```tsx
function RootLayout() {
	const { role: controlRole } = rootRoute.useSearch();
	const params = useParams({ strict: false });
	const { stateOverride } = rootRoute.useRouteContext();
	const live = usePlotWebDashboardState({
		sessionId: params.sessionId,
		role: controlRole,
	});
	const state = stateOverride ?? live;
	return (
		<DashboardProvider state={state}>
			<div className="min-h-screen overflow-y-auto bg-background">
				<Outlet />
			</div>
		</DashboardProvider>
	);
}
```

**Step 2:** Rewrite `FleetRoute` → render `<TriageLobby />`. Keep the single-reachable-session collapse, but ONLY when `roster.length === 1` (the `plot → open-web` case); otherwise the Lobby is the destination — do not auto-redirect. Update imports (drop `AppSidebar`, `OverviewPane`, sidebar primitives; add `TriageLobby`).

**Step 3:** Keep `sessionRoute` path `session/$sessionId` → it will render `<SessionRoom />` (Phase 3). For now temporarily keep it pointing at the existing `SessionSurface` so the app compiles between phases.

**Step 4:** Update `test/dashboard-import.test.tsx` `renderSession` to no longer wrap in `SidebarProvider`/`AppSidebar` (those render paths are gone). It should render the route's component within `DashboardProvider` only. The existing assertions on `"plot"` (was the sidebar wordmark) must move — `"plot"` now lives in the Lobby chrome, not the session route — so split: lobby assertions use `renderLobby`, session assertions use `renderSession` (Room).

**Step 5:** Typecheck + test + build.

Run: `cd packages/web && bun run typecheck && bun test && bun run build`
Expected: PASS. The app now lands on the Lobby; clicking a session still opens the old SessionSurface (replaced next phase).

**Step 6: Commit.**

```bash
git add packages/web/src
git commit -m "feat(web): land on Triage Lobby, drop sidebar shell"
```

---

## Phase 3 — Session Room + operator-action dialog

The Room is the two-pane zoomed detail. Most internals (`PulseHeader`, `SessionControls`, `Trail`, `useNow`, `useEsc`, operator-action buttons) are lifted from `session-surface.tsx` / `operator-actions.tsx` — this is a restructure, not a rewrite from zero.

### Task 3.1: Extract the operator-action dialog into its own module

**Files:**

- Create: `packages/web/src/app/dashboard/views/operator-action-dialog.tsx`
- Modify: `packages/web/src/app/dashboard/views/operator-actions.tsx` (keep `OperatorActionButtons`, `InterruptRunButton`; the inline Dialog moves out for reuse + clarity)

**Step 1:** Move the confirm/comment Dialog out of `OperatorActionButton` into a dedicated `OperatorActionDialog` component (420px modal, centered, scrim, required-comment validation: empty → `aria-invalid` + "· required"). The button calls it. Danger keeps the accent (no special red — `--destructive` is the accent now, so the existing `bg-destructive` class already renders accent; you may simplify `dangerClass` to drop the explicit red classes). **Do not reintroduce `window.confirm`** (the `no-ad-hoc` ratchet forbids it).

**Step 2:** Run the existing operator-action test (it asserts `Ship`/`Hold`/`not ready`/`controller required` render). It must keep passing after the move.

Run: `cd packages/web && bun test`
Expected: PASS.

**Step 3: Commit.**

```bash
git add packages/web/src/app/dashboard/views
git commit -m "refactor(web): extract operator-action dialog module"
```

### Task 3.2: Build the Session Room (two-pane)

**Files:**

- Create: `packages/web/src/app/dashboard/views/session-room.tsx`
- Reference: `session-surface.tsx` (lift `useNow`, `useEsc`, `dashboardModelFrom`, spring tiers, `oneLine`, `rowAge`, `Trail`, `PulseHeader`, `SessionControls`, `WatchingMeta`, `SnapshotUnavailable`).

**Step 1:** Compose the Room per the handoff §2. Structure:

```
SessionRoom (reads roster, selectedSessionId, projection, lastError)
  guard: projection === undefined → <SnapshotUnavailable lastError={lastError} />
  RoomTopBar       — "← all work · esc" (Link to "/") + SessionSwitcherRail
  IdentityHeader   — 46px monogram · workflow title (text-lg sans) · state pill ·
                     mode chip · sub-line (cwdName · workflowPath · provider/model) ·
                     right: Sparkline + tok/s   (lift from PulseHeader)
  LoopPulseStrip   — muted dot + "tick #214 · 8s ago · found 2 · started 1 ·
                     next tick 22s · 1/2 runs" (from model.pulse + runtime) ·
                     right: Live switch · Reconcile now · Close  (lift SessionControls)
                     observer → group dims to opacity-50 + "observer · read-only"
  DiagnosticsStrip — if model has diagnostics: neutral ink (decision #6), accent rail
  TwoPane (grid-cols-[minmax(0,360px)_1fr], min-h-[440px])
    LeftPane  — SectionLabel "work" + count; one WorkRow per model.work item:
                Rail (tone per status) · title · sub · right status (uppercase 2xs);
                selected row = bg-selected. j/k/enter selection (lift FleetColumn keys).
    RightPane — FocusedDetail keyed by workKey (slideUp 0.26s on focus change):
                glyph+title; subtitle + labels chips + url (accent link);
                by status: blocked → blockedReason box (bg-attention-soft);
                           failed → failMessage box + auto-retry wake line;
                           run → AgentRunPanel (header, stage, phases chips, check
                                 chip, run meta, commands block dark);
                           done/idle → one-line summary;
                operator-actions row (OperatorActionButtons, prominent);
                Interrupt (InterruptRunButton, running only);
                Timeline (lift Trail → 3-col age · KIND · text, newest-first +
                          live now shimmer).
```

Use `useNow(running ? 125 : 1000)` and `dashboardModelFrom(projection, now)` exactly as `SessionDetail` does. Focus state is local `useState<string|null>` defaulting to the first actionable (blocked) work item, else first work. `useEsc` returns to `/` via `useNavigate` (Link/esc are keyboard nav → **no enter animation**, per Emil + existing code comment).

> **Zoom transition (handoff "enter transition"):** transform-only `zoomIn` from the clicked row's origin. Implement with `motion` `initial={{ scale, opacity:1 }}` — **never animate opacity** on this path. If the origin plumbing (passing click coords lobby→room) adds complexity, ship the Room WITHOUT the zoom first (static), and add the zoom in Task 4.x. Mark it clearly. Do not block the Room on the animation.

**Step 2:** `SessionSwitcherRail` — one 30px monogram per `roster` session (`Link` to that session). Current = filled ink; a session with `needsYouCount > 0` shows a 7px accent dot. Reuse `sortPlotSessions` for order.

**Step 3:** State pill + mode chip — small kit-styled spans. State `error` → accent border + text (the one accent); everything else neutral.

**Step 4:** Wire `sessionRoute.component = SessionRoom` in `router.tsx`.

**Step 5:** Write/adapt the room tests. Port the existing session tests (the `attempt_started`/`agent_run_event`/blocked-operator/offline cases) to render `<SessionRoom />` through `renderSession`. Assertions on rendered text (`Prepare package`, `bun run check`, `Ship`/`Hold`/`not ready`/`controller required`) carry over — they test the projection→view mapping, which the Room preserves.

**Step 6:** Run failing → implement → green.

Run: `cd packages/web && bun test && bun run typecheck`
Expected: PASS.

**Step 7: Commit.**

```bash
git add packages/web/src/app/dashboard/views/session-room.tsx packages/web/src/router.tsx packages/web/test
git commit -m "feat(web): add Session Room two-pane view"
```

### Task 3.3: Retire the old surface + dead files

**Files:**

- Delete: `packages/web/src/app/dashboard/views/session-surface.tsx`, `app-sidebar.tsx`, `fleet-rail.tsx`
- Verify: nothing imports them (`rg -n "session-surface|app-sidebar|fleet-rail|OverviewPane|SessionSurface" packages/web/src`)

**Step 1:** Move any still-needed helpers that lived ONLY in `session-surface.tsx` (e.g. `useNow`, `useEsc`, `Divided`, `oneLine`, `rowAge`, `Trail`) into the Room or a small `room-internals.tsx` / `hooks/` before deleting. `useNow` is broadly useful → move to `src/hooks/use-now.ts`.

**Step 2:** Delete the three files.

**Step 3:** Typecheck + test + build + lint.

Run: `cd packages/web && bun run typecheck && bun test && bun run build && bun run lint`
Expected: PASS (lint targets `src/app src/components src/hooks src/lib` — ensure no dangling imports).

**Step 4: Commit.**

```bash
git add -A packages/web
git commit -m "refactor(web): remove fleet sidebar + legacy session surface"
```

---

## Phase 4 — Edge states & polish

Each is a small, independently-committable task. Reference handoff §"Edge States".

### Task 4.1: Connection-degraded look (edge-state #2)

Lobby chrome + Room top bar surface `connecting` / `offline · last frame` / `handoff-missing` via `connectionLabel` + a muted/attention `StatusDot`. Offline keeps the last good frame (already true — `projection` persists). Test: render `state({ connection: "offline", ... })`, assert `offline · last frame`. **Commit.**

### Task 4.2: Observer posture everywhere (edge-state #1)

Verify the Room control group dims (`opacity-50`) + shows `observer · read-only`, and every mutating control no-ops (already gated in `dashboard-context` actions). `mutationError` surfaces near the controls. Test: the ported observer test already covers `controller required`. **Commit.**

### Task 4.3: Empty fleet / snapshotUnavailable / oneshot (edge-state #5)

Lobby `EmptyFleet` copy; Room `SnapshotUnavailable` (already lifted); oneshot terminal auto-close handled by roster removal (no special UI beyond the watching/done treatment). Tests for empty roster + undefined projection. **Commit.**

### Task 4.4: draining / stale / superseded (edge-states #3, #4)

Work-list rail tones: `draining`/`done`/`stale` → `resolved` (settled stroke), no actions. Stale (>2min no event) lands in ATTENTION neutral. Covered by `dashboardModelFrom` already; assert rail tone class in a test. **Commit.**

### Task 4.5: Arbitrary content wrap/truncate (edge-state #7)

Operator-action `label`, `disabledReason`, `model`, `workflowPath` are extension-defined: ensure `truncate`/`min-w-0`/`flex-wrap` on their containers so long strings don't break layout. Add a test with a 200-char label. **Commit.**

### Task 4.6 (optional): Room zoom-in transition

If deferred in Task 3.2: thread the clicked row's bounding-rect origin from Lobby → Room (via router state or a tiny module-scoped ref) and apply transform-only `zoomIn` (`cubic-bezier(.2,.8,.2,1)`, ~0.44s), clearing after ~480ms. Honor `prefers-reduced-motion`; never on keyboard nav. **Commit.**

---

## Final verification

**Step 1:** Full gate.

Run: `cd packages/web && bun run typecheck && bun test && bun run lint && bun run build`
Expected: all PASS.

**Step 2:** Regenerate the ad-hoc baseline (it should only shrink — ideally toward empty).

Run: `cd packages/web && UPDATE_BASELINE=1 bun test test/no-ad-hoc.test.ts`
Then inspect `git diff packages/web/test/ad-hoc-baseline.json` — confirm counts dropped, none added. Revert if any grew (means new ad-hoc type/`window.confirm` slipped in — fix the source instead).

**Step 3:** Manual smoke (use the `verify` or `run` skill): land on `/` → Lobby groups correctly; click a needs-you session → Room with real operator actions; perform an action → optimistic resolve + toast; toggle observer → controls dim; `esc` → back to Lobby.

**Step 4:** Final commit + push, open PR against `main`.

---

## Invariant checklist (verify before PR)

- [ ] One semantic accent only (`--attention`); no blue/red on the product surface.
- [ ] All spacing via the `layout.tsx` kit on the 4px step; no fractional Tailwind steps, no ad-hoc `px-*` outside `px-gutter`.
- [ ] No new type sizes; four roles (Title/Label/Secondary/Data) + `SectionLabel`. Well under 15 variants.
- [ ] Base UI (coss `ui/`) primitives for all interactive components (Dialog, Button, Switch, Sparkline, Toast).
- [ ] `no-ad-hoc` ratchet green; baseline not increased.
- [ ] No new global state — only `dashboard-context` slices + local view state (focused workKey, dialog, toast, `useNow`).
- [ ] Composition patterns: explicit variant props (tones) not booleans; state in the provider; `use()` over `useContext`.
