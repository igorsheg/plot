# Plot Web — Control Plane Vision

> Status: revised / north-star · Date: 2026-06-14 · Owner: web
>
> This document is the full target picture for Plot's web surface: what it is,
> why it differs from the TUI, the UX it borrows from Symphony, the design
> system it stands on, and the core/protocol/transport changes required to get
> there. It is a vision, not an implementation plan — phasing is at the end.

---

## 1. North star

**Plot's web is the control plane for a fleet of Plot Sessions.**

The TUI answers one question for one attached Plot Session: _"what is this
session doing right now, and does anything need me?"_ The web answers the
question a terminal structurally cannot: _"across **all** my Plot Sessions — PR
review, releases, CI triage, docs — what is happening, what is failing, and what
needs me?"_ — in one pane of glass, live.

It is the difference between `top` (one process view) and a fleet dashboard
(every process the Local Plot Server knows about). The web is not a prettier
TUI. It is the layer **above** any single Plot Session, while preserving the
same drill-in model for that session.

Three commitments hold the vision together:

1. **Higher-up, but a superset.** The web is a multi-session roll-up whose
   drill-in view is _exactly_ the per-session projection the TUI renders. Parity
   at the Plot Session level, orchestration above it. (§4)
2. **Mission control, not a vital sign.** Plot supervises a fleet of concurrent
   Work Items and Agent Runs; the UI must show the fleet, not hide it behind one
   calm number. We adopt Symphony's process-table model. (§5)
3. **Calm by craft, not by emptiness.** Density done with restraint — the Fluid
   Functionalism surface system, one accent, earned motion, composition-pattern
   architecture. (§6)

---

## 2. Mental model

```
world ──> source ──> work item ──> agent run
           (observes)  (scheduled)   (executes)

  WORKFLOW      = durable Markdown definition: Sources + prompt + runtime config
  PLOT SESSION  = one live tick→reconcile→act loop created from a Workflow
                  over Sources, Work Items, and Agent Runs
  PLOT SERVER   = many Plot Sessions, supervised, indexed, attachable
  CLIENT        = TUI, web, or automation attached over the control protocol
```

- A **Workflow** (`WORKFLOW.md`) is a durable definition. It wires trusted
  TypeScript Extensions, Source configuration, and the prompt for an Agent Run.
- A **Source** observes some part of the world and proposes Work Items. An
  Extension is trusted TypeScript that may provide Sources and pi-mono tools; it
  is not the scheduling concept itself.
- A **Plot Session** is one live supervised run of a Workflow. It owns the
  `tick → reconcile → act` loop, starts Agent Runs, tracks retries, records
  Session History, and raises Needs You attention.
- An **Agent Run** is Plot's only first-class agent execution unit. The
  Source-launched subagent feature is being removed; Source-provided tools stay
  as direct pi-mono tool registration passthrough.
- A **Local Plot Server** is the per-user process that hosts many Plot Sessions
  across projects and fans their state out to many Client Connections.

The operator's job is **manage work, not supervise agents**. The web exists to
make that possible at fleet scale.

---

## 3. Topology

```
┌───────────────────────────────────────────────────────────────┐
│  CORE  (@plot/agent)                                           │
│  tick → reconcile → act · Sources · Work Items · Agent Runs    │
└───────────────────────────────────────────────────────────────┘
            ▲ one per Plot Session
┌───────────────────────────────────────────────────────────────┐
│  SESSION RUNTIME  (@plot/session)                              │
│  Workflow loading · pi-mono Agent Runs · Session History       │
│  projection events · Source tools passthrough                  │
└───────────────────────────────────────────────────────────────┘
            ▲ many per Local Plot Server
┌───────────────────────────────────────────────────────────────┐
│  LOCAL PLOT SERVER                                             │
│  registry · roster · lifecycle · auth · fan-out · index        │
│  transports: WebSocket + stdio JSONL for one control protocol  │
└───────────────────────────────────────────────────────────────┘
        ▲                         ▲                        ▲
   ┌─────────┐              ┌───────────┐            ┌───────────┐
   │  TUI    │              │   WEB     │            │ automation│
   │ client  │              │ client    │            │ client    │
   └─────────┘              └───────────┘            └───────────┘
```

The scheduler moat remains in core: reconciliation always happens before
dispatch. The major change is above it: Plot gets a per-user Local Plot Server,
Plot-owned append-only Session History, and a clean explicit control protocol.
Product entrypoints (`plot tui`, `plot run`, `plot web`) use that protocol by
default instead of creating invisible in-process islands.

---

## 4. The web's two-level information architecture

### Level 0 — the fleet roll-up (web-only)

The thing the TUI can't be. Every reachable Plot Session as a row/card.

```
your plots ───────────────────────────────────────────────────────────
● pr-review   igors/epic   watching   2/8 agents   1 needs you   1.2k tok/s   ↑12m
● release     plot-ai      watching   0/4 agents   1 needs you        —       ↑ 3m
○ docs        docs-site    idle       0/2 agents                       —       —
```

Per Plot Session: Workflow name · project/cwd identity · Session State · agents
active/max · **Needs You count** (the triage signal) · token throughput ·
runtime/activity. Sorted so anything needing a human floats up, then errors,
active work, paused sessions, idle/watchers, and recent stopped sessions. Click
a row → Level 1.

### Level 1 — the per-session Process Table (parity with the TUI)

This is the Symphony translation (§5) and is the shared projection the TUI and
web both render. The Process Table is organized around Work Items; the current
or most recent Agent Run is a column on the row.

```
pr-review · igors/epic · watching                 next act 38s ●
────────────────────────────────────────────────────────────────────
agents 2/8    throughput 1.2k tok/s ▁▂▃▅▇▆▄    tokens 5,080    ↑ 12m

needs you ────────────────────────────────────────────────── (amber)
▲ release v0.2.0   approval: dispatch?             [Approve] [Hold]

work ───────────────────────────────────────────────────────────────
 ●  item        stage     age/attempt   tokens   agent run   event
 ●  pr:120      running   3m / #1        1,240   run-42      reading web files
 ●  issue:71    running   1m / #1          320   run-43      command completed

retry ──────────────────────────────────────────────────────────────
 ↻  issue:71   attempt 2   in 8m   watchdog interrupted the Agent Run

ready 1 · done 1                                      next refresh 38s
```

### The graceful-degradation rule

**When the web can reach only one Plot Session, Level 0 collapses and it opens
straight into Level 1.** The app is still built against the same roster +
projection model; it simply skips the fleet screen when there is no fleet to
choose from.

---

## 5. UX/UI — translating the Symphony TUI

Symphony (OpenAI's reference for this exact domain) is the UX template. Its TUI
is **mission control / a process table** — one dense, self-refreshing screen
that answers _"how many agents are alive, what is each doing, is anything
failing or waiting on me?"_ Crucially, Symphony already shipped its own web port
(Phoenix LiveView), so the TUI→web path is proven — we take its structure and
beat its polish.

### The decision: Process Table over calm vital-sign

An earlier exploration landed on a centered "calm vital-sign" (one big number,
a heartbeat). **We are superseding that.** The vital sign is right for one thing
you trust ambiently; Plot's job is supervising a _fleet_, where a single number
actively hides what the operator came to see. The primary view is the Process
Table. We keep three things the calm version got right:

1. the **live heartbeat/countdown** → becomes the status-bar "next act in 38s"
   pulse (it maps cleanly to Symphony's "next refresh");
2. the **Needs You** attention zone (Symphony buries human-in-the-loop signals as
   red text in the EVENT column — we promote them);
3. **restraint** — fluid surfaces, one accent, no marketing hero.

### Regions (TUI → web)

| Symphony TUI                          | Plot web                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `│`-rail header KPIs                  | dense **status bar**: Session State · heartbeat countdown · agents N/max · token-throughput sparkline · tokens · runtime |
| `├─ Running` table (centerpiece)      | full-width **Process Table**, one row per Work Item, the PRIMARY focus                                                   |
| red EVENT signals (approval/input)    | promoted to a **Needs You** amber zone with Source-declared Operator Actions                                             |
| `├─ Backoff queue`                    | **retry** list, sorted soonest-first, live countdown per row                                                             |
| `Next refresh` countdown              | reuse the live countdown pattern                                                                                         |
| sparkline `▁▂▃▄▅▆▇█` (10-min, 24-col) | a token-throughput micro-chart in the status bar                                                                         |

### Work-row columns

`status dot · work item · stage · age/attempt · tokens · agent run · event`, all
`tabular-nums`, one flexible EVENT column, `divide-border` row hairlines,
grouped/sorted by status. Faithful to the TUI's rigid grid, but with Work Item
identity as the stable row key and Agent Run identity as attempt detail.

### Status & color semantics

One accent — **amber** — spent only where a human is needed.

| State               | Treatment               |
| ------------------- | ----------------------- |
| running             | foreground dot, neutral |
| blocked / Needs You | **amber** — the accent  |
| backoff / retry     | amber-dim + `↻` glyph   |
| failed              | `destructive` red       |
| ready / completed   | muted                   |

### Interactions the web earns

`j`/`k` row navigation · `Enter` expands a row into its timeline · copy Plot
Session / Work Item / Agent Run id · open URL · perform Source-declared Operator
Actions. Controller-only control commands include pause/resume, Reconcile now
(`request_tick`), interrupt Agent Run, and close session. Counters update live.
Symphony's TUI repaints on change with a ≥1s idle tick so countdowns keep moving
— we mirror that with the live countdown + protocol-driven row updates.

### Empty / edge states

`No active work` · `No queued retries` · `No sessions` · `Snapshot unavailable`
(server down) · `Offline`. Missing values render as muted `n/a`. Never garble —
degrade to the last good frame.

---

## 6. Design system foundation (built)

The web stands on a ported **Fluid Functionalism** (mickadesign) base — Pierre's
diffshub substrate was fully removed.

- **Theme.** An 8-level **surface ladder** paired 1:1 with a **shadow ladder**;
  elevation = surface + shadow. Interactive overlays (`--hover`/`--active`) are
  surface-relative. Light/dark/system + a shape (corner-radius) language.
  Tokens: `bg-surface-1..8`, `shadow-surface-1..8`, `text-foreground`,
  `text-muted-foreground`, `border-border`, `destructive`.
- **Typography.** Bundle Inter (`@fontsource/inter`) so the web matches the Fluid
  Functionalism substrate without remote font fetches. Use tabular numbers for
  counters, timing, tokens, and table columns.
- **Elevation by context.** `<Elevated offset>` reads the substrate level from
  `SurfaceProvider`, steps up, and re-provides — nesting walks the ladder
  automatically. Only what needs attention is raised.
- **Primitives.** Base-UI `Button`/`Badge`; compound molecules `Card`,
  `ListRow`, `Stat`, `Disclosure`. A `Table` primitive (port of fluid's) is the
  next addition for the process table.
- **Motion.** `motion` + a spring-token scale (`spring.fast/moderate/slow`).
  Earned, compositor-only, reduced-motion-safe. The heartbeat beats on the tick.
- **Architecture: composition-patterns (Vercel), strictly.** React 19
  ref-as-prop (no `forwardRef`), `use()` over `useContext`, compound components
  over render/boolean props, lifted state behind `{ state, actions }` context
  interfaces, explicit variant components over mode flags.

Principle: **the visual language is fully tokenized; structure is composed from
named molecules.** New product surfaces extend the system (contribute
primitives), they don't sprinkle ad-hoc utilities.

---

## 7. Core / protocol / transport evolution

The current implicit single-session `plot.v1` shape is not the target. Plot has
no external consumers yet, so we should break it now and replace it with one
explicit control protocol shared by WebSocket and stdio JSONL. Stdio remains a
framing option for automation/tests, not a legacy protocol.

### 7.1 Control protocol shape

A **Client Connection** is connection-scoped. It may attach to zero, one, or many
Plot Sessions.

- connect → `welcome` with server capabilities, limits, and identity/auth state;
- `list_sessions` returns the current Session Roster;
- `open_session` creates a Plot Session from a Workflow and registers it;
- `attach_session { sessionId, afterSequence? }` returns a projection snapshot +
  event frontier, then streams Session History events after the cursor;
- `detach_session { sessionId }` ends only that Session Attachment;
- all session-scoped commands name `sessionId` explicitly;
- command responses include an `asOfSequence` / `lastSequence` frontier when
  they affect Session History.

There is no hidden "current session" in the wire model.

### 7.2 Session History and replay

Plot owns a separate append-only JSONL **Session History** under the Plot
Session's resolved `sessionDir`. It records control-plane domain events, not
protocol records. pi-mono remains the owner of **Agent Transcripts**; Plot may
reference transcript IDs/paths but does not mutate or mingle with those files.

Session History events carry:

- `sessionId` — durable Plot Session identity;
- `epoch` — one live incarnation of that Plot Session;
- monotonic session-local `sequence`;
- `timestamp`, `type`, and payload.

Replay cursors use Session History sequence numbers. On server restart, Plot
starts a new epoch and appends recovery events that mark Agent Runs active in
the previous epoch as interrupted; retries happen only through the normal
`tick → reconcile → act` path.

### 7.3 Local Plot Server and Session Roster

`plot serve` grows into the **Local Plot Server**: a per-user process that owns
the registry, lifecycle, auth, roster fan-out, and user-level index/catalog. It
can host Plot Sessions from many projects. Project-local Session History remains
authoritative; the user-level index is only a catalog/cache for fast cross-
project roster loading.

Normal entrypoints (`plot tui`, `plot run`, `plot web`, automation) use or
autostart this Local Plot Server by default. If no server is reachable, they
start one; if stale connection metadata exists, they health-check and recover.

### 7.4 Transports

Use **WebSocket** for browser/control-plane transport because the protocol is a
duplex request/response plus event stream. HTTP POST + SSE would split commands
and events and reintroduce correlation/lifecycle complexity.

Keep stdio JSONL as another framing of the same explicit control protocol for
automation and tests. Product CLI shape should be concept-first:

- `plot serve` — headless Local Plot Server;
- `plot web` — use/autostart Local Plot Server and open the web app;
- `plot tui` / `plot run` — control-protocol clients by default.

### 7.5 Lifecycle commands

Use precise command vocabulary:

- `open_session` — create/start a Plot Session from a Workflow;
- `attach_session` / `detach_session` — manage a Client Connection's attachment;
- `pause_session` / `resume_session` — stop/resume future dispatch without
  interrupting active Agent Runs;
- `request_tick` — controller request for the loop to reconcile now; rejected
  while paused;
- `interrupt_agent_run { runId, workKey? }` — stop one active Agent Run;
- `close_session` — terminal lifecycle; interrupt active Agent Runs, stop
  scheduled ticks, run cleanup, keep Session History.

`detach` never kills work. `close_session` does not delete history.

### 7.6 Multi-client fan-out and command arbitration

Many clients may attach to one Plot Session. Each Session Attachment has a role:

- **Observer** — may watch snapshots/events;
- **Controller** — may issue authorized mutating commands.

No exclusive control lock in v1. Mutating commands are authorized, ordered,
audited, and reconciled; correctness comes from the Plot loop and Session
History, not last-writer-wins UI state.

Roster events are best-effort hints (`session_opened`, `session_changed`,
`session_closed`) and include full `PlotSessionSummary` payloads. `list_sessions`
is the authoritative refresh. Per-session detail uses durable Session History
cursors.

### 7.7 Operator Actions

Source-declared **Operator Actions** are generic choices a human may take on a
Work Item. They are not limited to blocked Work Items, though Needs You rows get
the most prominent rendering. Performing an Operator Action creates an
**Operator Observation** in Session History; Sources interpret it during
reconciliation. The web never calls Source code directly and Plot core does not
hard-code approval semantics.

V1 action shape stays small and generic:

```ts
interface OperatorAction {
	id: string;
	label: string;
	tone?: "primary" | "secondary" | "danger";
	disabledReason?: string;
	requiresComment?: boolean;
	confirm?: {
		title: string;
		message?: string;
	};
}
```

`id` is Source-defined and only needs to be unique within the Work Item's
current action set. The server validates that the action is currently declared,
not disabled, and satisfies `requiresComment` before recording the observation.
The client sends `sessionId`, `workKey`, `actionId`, and optional `comment`; the
server adds actor/client identity, timestamp, and an action-label snapshot.

Example actions may be rendered as Approve/Hold, Rerun/Ignore, Ship/Cancel, but
those labels and meanings belong to the Source.

### 7.8 Local auth, backpressure, and liveness

Local browser control still needs authentication:

- bind localhost by default;
- require a persistent per-user bearer token stored with user-only permissions;
- use browser-safe handoff such as a short-lived ticket or URL fragment;
- check browser Origin for localhost/dev origins.

Add heartbeat/ping, idle timeouts, and bounded per-subscriber queues. If a
subscriber falls behind, drop it and force resync from a snapshot + Session
History cursor. Remote exposure, TLS, and non-local auth are out of scope for
this slice.

---

## 8. Data model

Level 1 should be the shared per-session dashboard projection currently closest
to the TUI projection. It must move out of TUI-owned rendering so TUI, web, and
server roster summaries derive from one model.

1. **Add a Level-0 summary above the projection:**

   ```ts
   interface PlotSessionSummary {
   	id: string;
   	epoch: string;
   	mode: "watch" | "oneshot";
   	state:
   		| "starting"
   		| "watching"
   		| "reconciling"
   		| "acting"
   		| "idle"
   		| "paused"
   		| "stopping"
   		| "stopped"
   		| "error";
   	workflowName: string;
   	workflowPath: string;
   	cwd: string;
   	cwdName: string;
   	agents: { active: number; max: number };
   	needsYouCount: number;
   	tokenThroughputPerSecond: number | null;
   	totalTokens: number;
   	lastActivityAt: string | null;
   	attachments: { observers: number; controllers: number };
   }
   // Level 0 = PlotSessionSummary[]; click → that session's projection.
   ```

   `blocked` is not a Plot Session state. Needs You is a separate attention
   signal derived from Work Items.

2. **Process Table rows are Work Items:**

   Work Item rows carry stable Work Item identity plus current/last Agent Run
   detail: `workKey`, Source/display hints, status/stage, attempt, timing,
   tokens, current/last `runId`, retry/backoff information, timeline, URL, and
   Source-declared Operator Actions.

3. **Token throughput is tokens per second:**

   Use `tok/s` / `tokens/s`, not ambiguous `tps`. With Source-launched subagents
   removed, top-line usage is attributable to canonical Agent Runs in the Plot
   Session.

4. **Agent Transcript references are references only:**

   Plot projection may expose a transcript id/path for drill-in/debugging, but
   pi-mono owns the Agent Transcript. Plot Session History remains the source of
   truth for control-plane state.

---

## 9. Phasing

The implementation sequence follows the revised control-plane decisions: remove
secondary execution concepts first, make Plot's own Session History durable, then
put every product entrypoint on one Local Plot Server/control-protocol path.

1. **Remove Source-launched subagents.** Delete the public `runAgent`/`runAgents`
   SDK surface and runtime logic. Plot has one first-class execution unit: the
   Agent Run for a Work Item. Source-provided tools stay as pi-mono tool
   registration passthrough.
2. **Session History + shared projection.** Add Plot-owned append-only JSONL
   Session History under each session's resolved `sessionDir`; keep it separate
   from pi-mono Agent Transcripts. Move the dashboard projection out of TUI-owned
   rendering so TUI, web, and server summaries derive from one model.
3. **Explicit control protocol.** Replace the implicit single-session `plot.v1`
   shape before there are external consumers. A Client Connection receives a
   welcome, opens/attaches to Plot Sessions explicitly, and all session commands
   name `sessionId`.
4. **Local Plot Server + WebSocket.** Add the per-user Local Plot Server,
   localhost token auth, roster/index catalog, WebSocket transport, and stdio
   JSONL framing for the same protocol.
5. **Entrypoints on the protocol path.** Move `plot tui` and `plot run` to open
   or attach through the Local Plot Server by default. In-process hosts remain
   test/escape-hatch internals, not the product path.
6. **Web Level 1 + Level 0.** Build the web against roster summaries and the
   shared projection. If only one session is reachable, collapse to Level 1;
   otherwise show the fleet roll-up.
7. **Operator controls.** Ship Source-declared Operator Actions as Operator
   Observations plus control commands such as pause/resume, request tick,
   interrupt Agent Run, and close session.

Remote exposure is out of scope for this slice. The local UI should still be
structured so remote auth/TLS/origin policy can be added deliberately later.

---

## 10. Remaining open decisions

Resolved decisions are captured in `docs/adr/` and reflected above: WebSocket,
Local Plot Server, explicit control protocol, role-based command arbitration,
Operator Actions as observations, separate Session History vs Agent Transcripts,
the server index as a catalog, the browser-safe `@plot/control` package with Zod
schemas for protocol boundaries, initial stopped-oneshot retention, the V1
Operator Action shape, and bundling Inter for the web surface.

Stopped oneshot sessions are retained for the newest 100 sessions or 7 days,
whichever prunes more. Retention deletes both the user-level index entry and the
project-local Session History, but never prunes active, watching, paused, or
error sessions automatically.

No open design decisions remain in this vision document.

---

## Appendix — key code seams (today)

- Current protocol records / codec to replace: `packages/session/src/protocol.ts`
- Current transport-agnostic handler to refactor: `PlotProtocolShape` in
  `protocol-handler.ts`
- Current stdio JSONL adapter to preserve as framing: `protocol-stdio.ts`
  `runPlotProtocolStdio`
- Current single-session host seam to split into reusable session runtime:
  `session-host.ts` `createPlotProtocolSessionHost`
- Detached host primitive / lifecycle seed: `session-host.ts`
  `runPlotSessionHostDaemon`
- Serve entry to grow into Local Plot Server: `packages/cli/src/commands/serve.ts`
- TUI projection to extract/shared-own: `packages/tui/src/projection.ts`,
  `fleet-view.ts`, `dashboard-model.ts`
- pi-mono durability reference: `.references/pi-mono/packages/agent/src/harness/session/*`,
  `.references/pi-mono/packages/coding-agent/src/core/session-manager.ts`
- UX reference (TUI + its own web port): `.references/symphony/elixir/lib/symphony_elixir/status_dashboard.ex`,
  `.../symphony_elixir_web/live/dashboard_live.ex`
- Web design system: `packages/web/src/lib/{surface-*,shape-context,elevated,springs,theme-context}`,
  `packages/web/src/components/ui/*`
