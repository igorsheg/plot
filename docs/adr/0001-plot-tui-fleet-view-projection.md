# ADR 0001: Plot TUI Fleet View Projection

Status: Accepted

## Context

The Plot TUI needs to be useful when the PR reviewer has 5–10 concurrent running PR reviews. Raw protocol/agent event passthrough is valuable for debugging, but it is not an operator-friendly default view.

## Decision

Symphony optimizes for many concurrent workers by making the dashboard **row-oriented and summary-first**, not transcript-oriented.

From the Elixir dashboard:

- fixed-width running table columns
- one row per running issue/work item
- compact stage field
- compact age field
- compact session/worker field
- one summarized “last event/message” field
- token/throughput summary at top
- raw events/logs are not shown inline for every worker
- details for one issue are served separately by the presenter/API

For Plot PR review with 5–10 concurrent reviews, we should copy that.

## TUI should have two modes

### 1. Fleet view — default

Optimized for scanning all active reviews:

```txt
╭─ PLOT PR REVIEW DAEMON ──────────────────────────────────────────────
│ workflow=pr-review session=default status=running frontier=1287
│ agent=openai-codex/gpt-5.5 thinking=high skills=pr-review cwd=epic
│ running=7 completed=14 diagnostics=1 tick=32 next=04:12 events/min=96
├─ RUNNING REVIEWS
│ PR      stage          age     turn  checks        last
│ #123    exploring      08m12s  5     not-run       rg protocol-handler
│ #124    testing        14m02s  9     check running bun run test
│ #125    posting        03m44s  4     typecheck ok  gh api pulls/125/reviews
│ #126    reviewing      19m31s  12    check failed  found HIGH in session-host.ts
│ #127    thinking       01m03s  1     not-run       reading diff
│ #128    blocked/auth   00m17s  0     n/a           gh auth required
│ #129    idle-agent     06m22s  3     not-run       waiting for model
├─ RECENT COMPLETIONS
│ #121 COMMENT  inline=2  check=passed  11m ago
│ #120 BLOCKING inline=1  test=failed    18m ago
├─ DIAGNOSTICS
│ WARN #128 gh auth required
╰─ ↑/↓ select · enter details · c config · r tick · d debug · q shutdown
```

The important thing: **one line per PR**.

No raw event spam in fleet view.

### 2. Detail view — selected PR

Shows useful timeline for one review:

```txt
╭─ REVIEW #126 ───────────────────────────────────────────────
│ title=Fix protocol replay cursor
│ status=running stage=reviewing age=19m31s turn=12
│ head=abc123 base=main checks=bun run check failed
├─ CURRENT ACTIVITY
│ found HIGH in packages/session/src/protocol-handler.ts:175
├─ FINDINGS DRAFTED
│ HIGH protocol-handler.ts:175 replay cursor can drop events
│ MEDIUM tui.ts:88 stale snapshot under event burst
├─ COMMANDS
│ ✓ gh pr view --json ...
│ ✓ rg replayAfter packages/session
│ ✗ bun run check
├─ TIMELINE
│ 14:23:11 running command bun run check
│ 14:22:04 reading protocol-handler.ts
│ 14:20:41 found potential replay bug
╰─ esc fleet · d raw events
```

## What to project per PR/review

For 5–10 concurrent runs, each row needs:

```ts
interface ReviewRunProjection {
	workKey: string;
	prNumber?: number;
	title: string;
	url?: string;

	status: "running" | "completed" | "failed" | "blocked";
	stage:
		| "discovering"
		| "fetching-pr"
		| "exploring"
		| "reading"
		| "testing"
		| "reviewing"
		| "posting"
		| "waiting"
		| "blocked/auth"
		| "failed";

	ageMs: number;
	turnCount: number;
	lastEventAt?: number;
	lastMessage: string;

	checks: {
		typecheck?: "passed" | "failed" | "running";
		test?: "passed" | "failed" | "running";
		check?: "passed" | "failed" | "running";
	};

	reviewDraft: {
		findings: number;
		high: number;
		medium: number;
		low: number;
		inlineCommentsPlanned?: number;
		disposition?: "COMMENT" | "BLOCKING_COMMENT";
	};
}
```

## How to infer stage

Do this in the TUI projection, best-effort:

- `gh pr view`, `gh pr diff` → `fetching-pr`
- `rg`, `git grep`, file reads → `exploring` / `reading`
- `bun run typecheck`, `bun run test`, `bun run check` → `testing`
- messages containing `HIGH`, `MEDIUM`, `finding`, `issue` → `reviewing`
- `gh api .../pulls/.../reviews`, `gh pr review` → `posting`
- auth errors → `blocked/auth`

This does not need to be perfect. It needs to be useful.

## Runtime identity in fleet view

Fleet view should show compact runtime identity, not a full config dump. It should answer: “what daemon am I looking at, and under what agent/runtime settings?”

Show in the fleet header when space allows:

- workflow name
- session id
- status/frontier
- provider/model
- thinking level if available
- loaded skill names or skill count
- cwd/project basename
- maybe tick interval / max concurrency if space allows

Avoid by default:

- full skill paths
- full prompt
- secrets/auth details
- full env vars
- giant config/frontmatter

Expose expanded runtime details behind a config/details mode, for example `c config`:

```txt
├─ RUNTIME
│ workflow: examples/pr-review/WORKFLOW.md
│ cwd: /Users/igors/workspace/dev/personal/epic
│ provider: openai-codex
│ model: gpt-5.5
│ thinking: high
│ skills:
│   - examples/pr-review/skills/pr-review
│ tick interval: 5m
│ max concurrency: 2
│ max run duration: 15m
```

## Fixed style tokens and semantic color system

Plot should not expose user-contributed themes for this dashboard. It should still have a clear internal design system so the TUI is cohesive and maintainable.

Learn from pi-mono’s interactive theme system:

- separate raw color values from semantic roles
- name colors by purpose, not by call site
- make components consume role functions/tokens instead of hard-coded ANSI
- support terminal capability differences (`truecolor`, `256color`, no-color)
- provide component-facing style contracts for markdown/select/editor-like surfaces
- keep background/status/tool/error styles distinct from plain text styles

Pi-mono’s theme roles are a useful reference taxonomy:

- Core UI: `accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`
- Background/content: `selectedBg`, message backgrounds/text, tool pending/success/error backgrounds, `toolTitle`, `toolOutput`
- Markdown: `mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`
- Diffs: `toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`
- Syntax: `syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`
- Thinking levels: `thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`
- Mode accents: `bashMode`

Plot should adapt this into a fixed internal style module, for example `packages/tui/src/style.ts`, with two layers:

1. **Base tokens** — fixed palette and terminal rendering helpers.
2. **Semantic tokens** — Plot dashboard roles consumed by product rendering.

Example shape:

```ts
export const palette = {
	accent: "#8abeb7",
	border: "#5f87ff",
	borderAccent: "#00d7ff",
	borderMuted: "#505050",
	success: "#b5bd68",
	error: "#cc6666",
	warning: "#ffff00",
	muted: "#808080",
	dim: "#666666",
	text: "#d4d4d4",
} as const;

export const style = {
	appTitle: token("accent", "bold"),
	border: token("borderMuted"),
	borderAccent: token("borderAccent"),
	label: token("text", "bold"),
	value: token("accent"),
	muted: token("muted"),

	status: {
		running: token("success"),
		idle: token("accent"),
		warning: token("warning"),
		error: token("error", "bold"),
		success: token("success"),
	},

	severity: {
		high: token("error", "bold"),
		medium: token("warning"),
		low: token("accent"),
	},

	stage: {
		exploring: token("accent"),
		reading: token("border"),
		testing: token("warning"),
		reviewing: token("thinkingHigh"),
		posting: token("success"),
		waiting: token("muted"),
		blocked: token("error"),
		failed: token("error", "bold"),
	},
} as const;
```

Product code should never directly emit raw ANSI. It should call semantic roles:

```ts
style.status.running("running");
style.stage.testing("testing");
style.severity.high("HIGH");
style.border("├─ RUNNING");
```

not:

```ts
color("running", ansi.green);
```

This is not a customization API. It is a fixed design system for Plot’s TUI.

No-color support is still required for terminal correctness:

- `NO_COLOR` set → plain strings
- `TERM=dumb` → plain strings
- truecolor-capable terminals → RGB escape sequences
- otherwise fall back to 256-color or basic ANSI approximation

## Rendering rules for 5–10 workers

- Cap running rows to available height.
- Sort by:
  1. blocked/failed first
  2. oldest running
  3. newest activity
- Keep each row single-line.
- Truncate title/last message aggressively.
- Use color:
  - green = healthy/running
  - yellow = testing/posting/waiting
  - red = failed/blocked/high finding
  - gray = idle/no recent activity
- Keep raw event feed behind `d`.
- Detail view for selected run only.

## Symphony lesson

Symphony does **aggregation + last meaningful signal**, not event log display.

For Plot, the TUI should answer at a glance:

1. Is the daemon alive?
2. How many reviews are running?
3. Which PRs are stuck?
4. What is each review currently doing?
5. Did anything fail?
6. What finished recently?
7. Where do I drill in?

## Projection ownership and raw event retention

Plot should preserve a strict architecture boundary:

- `@plot/session` and the Plot protocol continue to expose raw protocol/session/agent events.
- `@plot/tui` owns projection/reduction from raw events plus snapshots into operator-facing state.
- Fleet view renders the projection only.
- Raw event feed remains available behind debug mode, for example `d debug`.
- Projection is best-effort and must never affect Plot runtime behavior, scheduling, reconciliation, or completion semantics.
- Projection failures should degrade the TUI display, not the daemon.

This keeps protocol/debug fidelity while avoiding raw event spam as the default UX.

## Implementation order

1. Add `packages/tui/src/style.ts`:
   - fixed palette
   - semantic style roles
   - no-color support
   - replace raw ANSI in product rendering
2. Add `packages/tui/src/projection.ts`:
   - reducer from `PlotServerRecord` plus snapshots to dashboard projection
   - running rows keyed by `workKey`
   - best-effort stages/checks/last message
   - raw debug event buffer retained separately
3. Add `packages/tui/src/dashboard.ts`:
   - render fleet view from projection
   - row-oriented layout
   - config/debug/detail modes later
4. Keep `packages/tui/src/plot-tui.ts` thin:
   - protocol wiring
   - input handling
   - snapshot/event subscription
   - delegates projection and rendering
5. Add behavior tests:
   - projection maps agent/tool events to stages
   - fleet render stays single-line per run
   - default view does not spam raw events
   - debug mode still exposes raw events

Start with fleet view, style, and projection. Defer full detail view until the default operator UX is solid.

That is the control-plane UX.
