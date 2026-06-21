# Handoff: Plot — Reimagined Web Dashboard

## Overview

A ground-up redesign of the **Plot** web dashboard — the control surface for a fleet of
autonomous coding-agent sessions running on the Local Plot Server. It replaces the
"fleet sidebar + session room" shell with a layered model:

- **Attention is global, context is local.** A **Triage lobby** routes you to whatever needs
  a human across the whole fleet, then **zooms into a per-session Room** with full,
  repo-specific depth (the agent run, its timeline, operator actions).
- **One palette rule, enforced everywhere:** _monochrome = autonomous & fine; the single
  burnt-orange accent (`#cf5a2e`) is reserved for one meaning — a human is needed_
  (blocked/failed work with an operator action, and `danger`-toned actions). Live/running
  work stays monochrome.

The design is grounded in the real `@plot/control` model (operator actions, work status,
agent-run projection, loop pulse) — not invented concepts. See **Data Mapping** below.

## About the Design Files

The files in this bundle are **design references created as self-contained HTML prototypes**
(a small streaming "Design Component" runtime is inlined; ignore it — it is not part of the
design). They show intended look and behavior. **Do not ship the HTML.** The task is to
**recreate these designs inside the existing Plot web app** — the React + TanStack Router
dashboard whose current source lives in files like `dashboard/views/app-sidebar.tsx`,
`dashboard/views/session-surface.tsx`, `dashboard/views/layout.tsx`,
`dashboard/dashboard-context.tsx`, and the `@plot/control` package
(`projection.ts`, `dashboard-model.ts`, `operator.ts`, `session-summary.ts`). Reuse that
codebase's primitives (the `Stack`/`Row`/`Meta`/`Rail`/`SectionLabel` layout kit, the coss
`Sidebar`/`Dialog`/`Button`/`Switch`/`Sparkline` components, `cn`, the 4px rhythm, the
`formatTokens`/`formatCost`/`formatDuration` helpers) — match their patterns, don't fork them.

## Fidelity

**High-fidelity.** Final colors, type, spacing, and interactions. Recreate pixel-faithfully
using the codebase's existing libraries. The two files:

- **`Plot Room.dc.html`** — the primary deliverable: an interactive prototype of the
  Triage lobby ↔ Session Room with working state (focus, role posture, operator-action
  dialog, optimistic resolve). **This is what you implement.**
- **`Plot Reimagined.dc.html`** — exploratory only: five side-by-side metaphor concepts
  (Triage, Stream, Work Board, Vitals Monitor, Ledger). Not for direct implementation; the
  Stream/Ledger/Vitals can later become summonable "lenses." Keep as reference.

---

## Design Tokens

### Color

| Token           | Hex                               | Use                                            |
| --------------- | --------------------------------- | ---------------------------------------------- |
| `bg`            | `#f1f0ea`                         | app background (warm paper)                    |
| `surface`       | `#faf9f5`                         | cards, header strips                           |
| `surface-white` | `#ffffff`                         | run panel / inset panels                       |
| `ink`           | `#1c1b18`                         | primary text, live dots, dark command/toast bg |
| `t2`            | `#57554d`                         | secondary text                                 |
| `t3`            | `#9b988d`                         | meta / low-emphasis text                       |
| `faint`         | `#bdbab0`                         | timestamps, disabled glyphs                    |
| `line`          | `#e6e4dc`                         | hairlines/borders                              |
| `line-soft`     | `#efeee8`, `#ebe9e2`              | row separators                                 |
| `line-strong`   | `#d8d6cc`                         | button borders                                 |
| `selected`      | `#ecebe4`                         | selected row / label chip bg                   |
| `hover`         | `#f3f1ec` / `#f5f3ed` / `#f0efe8` | hover backgrounds                              |
| **`accent`**    | **`#cf5a2e`**                     | **the one accent — "needs a human"**           |
| `accent-hover`  | `#b94a23`                         | primary button hover                           |
| `accent-soft`   | `rgba(207,90,46,.05)`             | needs-you / attention tints                    |
| `accent-border` | `#e6c9bc` / `#e0c6ba`             | borders on accent surfaces                     |
| `dark-text`     | `#cfccc2`                         | text on `#1c1b18` (commands, toast)            |
| `dark-prompt`   | `#857f72`                         | `$` prompt in command block                    |

Diagnostics/stale also use the accent today; **consider keeping non-actionable diagnostics
neutral** so the accent stays reserved for actionable items (open question — see Edge States).

### Typography

- **Mono (default, everything):** `JetBrains Mono`, weights 400/500/600/700.
- **Sans (headings only):** `IBM Plex Sans`, weight 500 — used for the room's workflow
  title (19px) and the board's big title. Nothing else.
- Roles: page/section data 12–13px; meta 11px; micro 10–10.5px; workflow title 19px/500 sans;
  section labels 11px **uppercase**, `letter-spacing:.14–.16em`, color `t3` (accent when "needs you").
- `tabular-nums` feel comes free from the mono. Numbers/ids/ages are always mono.

### Spacing / Radius / Shadow

- App column: `max-width:1080px`, centered, page padding bottom 80px.
- Room two-pane grid: `grid-template-columns: minmax(0,360px) 1fr`, `min-height:440px`.
- Radius: cards `4px`, buttons `3px`, pills/chips `10px`, monogram `6px`, rails `2px`.
- Status rail: `width:3px`, rounded — a stroke, exempt from the 4px grid (matches existing `<Rail>`).
- Shadow: card `0 1px 3px rgba(0,0,0,.08)`; modal `0 12px 40px rgba(0,0,0,.22)`; toast `0 6px 24px rgba(0,0,0,.18)`.
- Monogram tile: `46×46`, bg `ink`, text `bg`, 13px/600. Switcher tile: `30×30`, 9.5px/600.
- Live dot: nested span, `6–8px`, `beat` keyframe (scale→2.6, fade) 1.7–2.4s.

---

## Screens / Views

### 1. Triage Lobby (default view)

**Purpose:** answer "what across my whole fleet needs me?" and route into a session.

**Layout:** single centered column. Top chrome row → NEEDS YOU card → ATTENTION strip →
ACTING list → WATCHING·SCHEDULED list → footer hint.

- **Chrome row:** live dot + `plot` wordmark (15px/600) · `online` · **role toggle**
  (`controller`/`observer`, a text button with `⇅`, flips `controlRole`) · session count.
  Right: throughput sparkline + fleet `tok/s`.
- **NEEDS YOU** (card, `surface`, `line` border): section label in **accent**, count in accent.
  One row per **actionable work item** = work with `status: "blocked"` **or** `"failed"` that
  carries at least one enabled operator action. Each row: 3px accent rail · work `title`
  (click → open session focused on it) · right meta `workflowName · cwdName` · the
  `blockedReason`/failure text · the **real operator-action buttons** (tone-styled, see
  Components) · `open →`.
- **ATTENTION** (accent left-border strip, `accent-soft` bg): FYI, non-actionable —
  `diagnostics` (rendered `level/phase` tag + message) and **stale** runs
  (`tag:"stale"`, "<title> · last event Nm ago"). Mirrors `dashboard-model`'s attention split.
- **ACTING · self-driving:** sessions with `state` acting/running. Row: live dot · `workflowName`
  · the current run's live **activity line** (shimmer) · `cwdName` · `agents.active/max`. Click → room.
- **WATCHING · SCHEDULED:** sessions in `watching`/`idle`. Row: glyph (`○`/`↻`) · `workflowName`
  · subtitle · next-tick / retry text. Click → room.
- **Footer hint:** "⌘K to jump… operator actions record an observation back into the Plot loop."

### 2. Session Room (zoomed-in detail)

**Purpose:** full per-repo context for one session and its work.

**Enter transition:** the room scales in from the clicked row's position
(`transform-origin` set to click point, `zoomIn` 0.44s `cubic-bezier(.2,.8,.2,1)`,
**transform-only — never animate opacity**, see Edge States note on offscreen render).
Clear the animation ~480ms after to keep it static. Back = `esc` or `← all work`.

- **Top bar:** `← all work · esc` (left) · **session switcher** rail (right): one 30px monogram
  per session; current = filled ink; a session with actionable work shows a 7px accent dot.
  Click a monogram → travel to that room (re-zooms from the monogram).
- **Identity header:** 46px monogram · workflow title (19px sans) · **state pill**
  (`acting`/`watching`/`idle`/`paused`/`error`; error → accent border+text) · **mode chip**
  (`watch`/`oneshot`, uppercase pill). Sub-line (11px t3): `cwdName · workflowPath · provider/model`.
  Right: throughput sparkline + `tok/s`.
- **Loop-pulse strip** (`surface`, hairline top+bottom): muted dot + one line:
  `tick #214 · 8s ago · found 2 · started 1 · next tick 22s · 1/2 runs`
  (real `LoopPulse` + `tickIntervalMs` + `scheduledWakes` + `attempts.size`/`maxConcurrentRuns`).
  Right controls: **Live** switch (pause/resume) · **Reconcile now** (`request_tick`) · **Close**.
  When `observer`, the whole control group dims to `opacity:.5` and shows `observer · read-only`;
  every control no-ops with a "Controller required" toast.
- **Diagnostics strip** (if any): accent-tinted, `diagnostic` tag + first diagnostic.
- **Two panes:**
  - **Left — work list:** `SectionLabel "work"` + count. One row per work item:
    3px status rail · `title` · sub (running → live activity shimmer; blocked → "waiting for you";
    stale → subtitle; else subtitle) · right `status` (uppercase micro). Selected row = `selected` bg.
    Rail tone: resolved→`line-strong`, stale→`line-strong`, blocked/failed→**accent**, running→ink, else→muted.
  - **Right — focused detail** (slides up 0.26s on focus change; keyed by workKey):
    glyph + title; subtitle + `labels` chips + `url` (accent link).
    Then, by status:
    - **blocked** → `blockedReason` box (accent-soft).
    - **failed** → `failMessage` box + `↻ auto-retry…` wake line.
    - **agent run panel** (any work with a run): header `agent run · <runId>` + `stage · <stage>`;
      live activity shimmer (running only); **phases chips** (`think·3 read·6 edit·9 test·2`);
      **check** chip (`check passed`/`check failed` accent/`checking…`); run meta
      `31.8k tok · $0.27 · turn 2 · 284 events · 38 meaningful`; **commands** block (dark, `$ …`).
    - **done/idle** → one-line summary.
    - **operator actions** row (tone-styled buttons; observer → dimmed + "controller required").
    - **Interrupt agent run** (running only; guarded by role).
    - **timeline** (real run `timeline`): 3-col grid `age · KIND · text`, newest first, with a
      live `now` shimmer row when streaming. KIND is the `activityKind` (`think/read/edit/search/run/test/finish/message/wait`).

### 3. Operator-Action Dialog (confirm / comment)

Opens when an action has `confirm` or `requiresComment` (matches existing
`operator-actions.tsx`). Centered modal (420px) over a `rgba(28,27,24,.28)` scrim:
title (`confirm.title` or label) · optional `confirm.message` · optional **comment textarea**
(required-validation: empty → accent border + "· required") · Cancel / confirm button
(tone-styled, danger keeps accent). `esc` closes. Performing records the observation
(toast) and optimistically resolves the item.

---

## Interactions & Behavior

- **Open session:** click a needs-you title / `open →` / acting/idle row / switcher monogram →
  set view=room, focus the session's first actionable work (else first work), zoom from origin.
- **Focus work:** click a left-pane row → swap right pane (no zoom; 0.26s slide-up).
- **Operator action:** plain → perform immediately; `confirm`/`requiresComment` → dialog.
  Performing = optimistic resolve (item drops out of NEEDS YOU, count decrements, detail shows
  "✓ <label> — observation recorded"). In real app this is `perform_operator_action`
  → an operator observation fed back into the Plot loop.
- **Role toggle:** controller ⇄ observer. Observer dims/disables all mutating controls and
  operator actions with a "Controller required" affordance (maps to `controllerBlockReason`).
- **Session controls:** Live = pause/resume; Reconcile now = request_tick; Close = confirm dialog;
  Interrupt = interrupt_agent_run. All controller-gated.
- **Keyboard:** `esc` closes dialog, else returns to lobby. (Recommended fast-follow:
  `j/k` move work selection, `enter` focus, `⌘K` session-jump palette — the old TUI parity.)
- **Animation:** `beat` (live dots), `shimmer` (live activity text via gradient background-clip),
  `zoomIn` (room enter, transform-only), `slideUp` (detail), `toastIn`. Honor
  `prefers-reduced-motion`; **never animate keyboard-initiated navigation** (existing code note).

## State Management

Map to the existing `dashboard-context` slices — do not introduce new global state:

- `connection` (`online|connecting|offline|handoff-missing`), `roster`, `selectedSessionId`,
  `projection`, `lastError`, `mutationError`, `snapshotUnavailable` (state slice).
- `controlRole`/`isController`/`controllerBlockReason` (meta slice) ← drives observer posture.
- `mutateSession`, `performOperatorAction`, `interruptRun` (actions slice).
- Local view state only: current view (lobby/room — already the router path), focused `workKey`,
  dialog open + comment, zoom origin/done, toast. A live render clock (125ms acting / 1s idle)
  is required so ages/throughput tick — reuse the existing `useNow` pattern; the projection
  coalescer publishes at ~100ms.

## Data Mapping (design element → real model)

| Design element               | Real source                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NEEDS YOU item               | `WorkItemProjection.status === "blocked"` (and `needsYouCount` on the summary) with an enabled `operatorActions[]` entry                                        |
| Operator action button       | `OperatorAction { label, tone: primary\|secondary\|danger, confirm?, requiresComment?, disabledReason? }`                                                       |
| ATTENTION rows               | `projection.diagnostics` + stale/failed rows from `dashboard-model` attention logic (stale = no event > 2 min)                                                  |
| Acting row's live line       | `AgentAttemptProjection.activity` + `activityKind` (verb label)                                                                                                 |
| Loop-pulse strip             | `projection.pulse` (LoopPulse) + `runtime.tickIntervalMs` + `scheduledWakes` + `attempts.size`/`runtime.maxConcurrentRuns`                                      |
| Identity header              | `summary.workflowName`, `runtime.cwdName/cwd`, `runtime.workflowPath`, `mode`, `runtime.provider/model`, `summary.state`                                        |
| Work list status             | `WorkStatus = pending\|running\|blocked\|draining\|done\|failed`                                                                                                |
| Run panel                    | `AgentAttemptProjection`: `stage`, `phases[] {kind,count}`, `check`, `tokens {total,cost}`, `commands[]`, `turnCount`, `eventCount`, `meaningfulCount`, `runId` |
| Timeline                     | `attempt.timeline[] {atMs, text, kind}` (kind = activityKind) + live `streaming` row                                                                            |
| Throughput sparkline / tok·s | `tokenSamples` (60s window, 8 buckets) + `formatTokens`                                                                                                         |
| Done summary                 | `CompletedWorkProjection {status,message,durationMs,tokens,url}`                                                                                                |
| Connection / role            | `connection` + `controlRole`/`controllerBlockReason`                                                                                                            |

## Edge States to implement (the mock only samples some)

1. **Observer posture** _(prototyped)_ — all mutations disabled + `controllerBlockReason`; `mutationError` surfacing on failed send.
2. **Connection degraded** — `offline · last frame`, `handoff-missing`, `connecting`: the room and lobby need a degraded look, not just "online".
3. **draining** _(prototyped)_ / superseded work — muted treatment, no actions, drains out.
4. **stale** runs _(prototyped)_ — > 2 min no event → ATTENTION + muted rail.
5. **Empty fleet**, `snapshotUnavailable`, **oneshot terminal auto-close**.
6. **Accent discipline:** decide whether diagnostics stay accent or go neutral (recommended) so the accent stays reserved for actionable.
7. **Arbitrary content:** operator-action `label`s, `disabledReason`, `model`, `workflowPath` are extension-defined — specify wrap/truncate (mock assumes short strings).
8. **`needsYouCount` semantics:** real count is **blocked + enabled action** only. The mock also folds failed-with-actions into NEEDS YOU — pick one and keep badge + section consistent.

## Files

- `Plot Room.dc.html` — primary interactive prototype (Triage lobby ↔ Session Room, dialog, posture).
- `Plot Reimagined.dc.html` — exploratory 5-concept board (reference only).
  Open either directly in a browser to interact. Ignore the inlined runtime/`<script>` — design lives in the markup + inline styles.
