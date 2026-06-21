import { describe, expect, mock, test } from "bun:test";
import {
	applySnapshot,
	emptyProjection,
	reduceSessionHistoryEvent,
} from "@plot/control/projection";
import type { SessionHistoryEvent } from "@plot/control/session-history";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { renderToStaticMarkup } from "react-dom/server";

import {
	chooseInitialSession,
	sortPlotSessions,
	visibleFleetSessions,
} from "../src/app/dashboard/fleet-model";
import type { PlotWebDashboardState } from "../src/app/dashboard/web-dashboard-state";

// The router's <Link> needs a RouterProvider, and TanStack Router won't build
// its route tree under bun's non-DOM test env. Stub <Link> to a plain anchor so
// the surfaces — where the asserted markup actually comes from — render directly
// through the DashboardProvider. The routing itself is declarative glue, and
// the collapse decision (chooseInitialSession) is unit-tested below.
mock.module("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
	}: {
		children?: unknown;
		className?: string;
	}) => <a className={className}>{children as never}</a>,
	// status.tsx's RoleToggle reaches for useNavigate; stub it so the surfaces
	// that import status (sidebar/session) resolve under the non-DOM test env.
	useNavigate: () => () => undefined,
}));

const { DashboardProvider } =
	await import("../src/app/dashboard/dashboard-context");
const { SessionRoom } = await import("../src/app/dashboard/views/session-room");
const { TriageLobby } = await import("../src/app/dashboard/views/triage-lobby");

// Render the Triage Lobby for a fixed frame — the cross-fleet summary surface
// the index route lands on. Summary-only: no projection attaches here.
function renderLobby(override: PlotWebDashboardState): string {
	return renderToStaticMarkup(
		<DashboardProvider state={override}>
			<TriageLobby />
		</DashboardProvider>,
	);
}

// Render just the session route's component for a fixed frame. The sidebar
// shell is retired — the router now renders the session component directly
// inside the DashboardProvider scroll container, so the harness mirrors that.
function renderSession(override: PlotWebDashboardState): string {
	return renderToStaticMarkup(
		<DashboardProvider state={override}>
			<SessionRoom />
		</DashboardProvider>,
	);
}

const summary = (
	overrides: Partial<PlotSessionSummary> & Pick<PlotSessionSummary, "id">,
): PlotSessionSummary => ({
	id: overrides.id,
	epoch: overrides.epoch ?? "epoch-1",
	mode: overrides.mode ?? "watch",
	state: overrides.state ?? "idle",
	workflowName: overrides.workflowName ?? overrides.id,
	workflowPath: overrides.workflowPath ?? "WORKFLOW.md",
	cwd: overrides.cwd ?? `/repo/${overrides.id}`,
	cwdName: overrides.cwdName ?? overrides.id,
	agents: overrides.agents ?? { active: 0, max: 4 },
	needsYouCount: overrides.needsYouCount ?? 0,
	tokenThroughputPerSecond: overrides.tokenThroughputPerSecond ?? null,
	totalTokens: overrides.totalTokens ?? 0,
	lastActivityAt: overrides.lastActivityAt ?? null,
	attachments: overrides.attachments ?? { observers: 0, controllers: 0 },
});

const state = (
	overrides: Partial<PlotWebDashboardState>,
): PlotWebDashboardState => ({
	connection: "online",
	roster: [],
	controlRole: "controller",
	...overrides,
});

const workStarted = (sessionId: string): SessionHistoryEvent => ({
	sessionId,
	epoch: "epoch-1",
	sequence: 1,
	timestamp: "2026-06-15T00:00:00.000Z",
	type: "attempt_started",
	payload: {
		run: {
			workKey: "work:alpha",
			runId: "run-1",
			sourceId: "source",
			display: { primary: "alpha", title: "Prepare package" },
		},
	},
});

describe("plot web dashboard", () => {
	test("sorts Level 0 by Needs You, error, active, paused, idle, stopped and collapses stopped", () => {
		const sessions = [
			summary({ id: "stopped", state: "stopped" }),
			summary({ id: "idle", state: "idle" }),
			summary({ id: "paused", state: "paused" }),
			summary({ id: "active", state: "acting", agents: { active: 1, max: 4 } }),
			summary({ id: "error", state: "error" }),
			summary({ id: "needs", needsYouCount: 1 }),
		];

		expect(sortPlotSessions(sessions).map((session) => session.id)).toEqual([
			"needs",
			"error",
			"active",
			"paused",
			"idle",
			"stopped",
		]);
		expect(
			visibleFleetSessions(sessions, false).map((session) => session.id),
		).not.toContain("stopped");
	});

	test("a single reachable session collapses to /session and renders it", () => {
		const session = summary({ id: "session-1", workflowName: "release" });
		const projection = reduceSessionHistoryEvent(
			emptyProjection("session-1", "release"),
			workStarted("session-1"),
		);
		// The collapse decision itself (index route → session) is unit-tested here;
		// the destination render is asserted below.
		expect(
			chooseInitialSession({ roster: [session], explicitFleet: false }),
		).toBe("session-1");
		const html = renderSession(
			state({
				roster: [session],
				selectedSessionId: "session-1",
				projection,
			}),
		);
		// The session route renders the work; the `plot` wordmark now lives in the
		// Lobby chrome (the sidebar is retired), so assert it via renderLobby.
		expect(html).toContain("Prepare package");
		const lobbyHtml = renderLobby(state({ roster: [session] }));
		expect(lobbyHtml).toContain("plot");
	});

	test("projection events render an updated Level 1 Work Item row", () => {
		const session = summary({ id: "session-1", workflowName: "build" });
		const agentEvent: SessionHistoryEvent = {
			sessionId: "session-1",
			epoch: "epoch-1",
			sequence: 2,
			timestamp: "2026-06-15T00:00:01.000Z",
			type: "agent_run_event",
			payload: {
				workKey: "work:alpha",
				runId: "run-1",
				sourceId: "source",
				eventType: "tool_execution_start",
				event: {
					type: "tool_execution_start",
					toolName: "bash",
					args: { command: "bun run check" },
					toolCallId: "tc-2",
				},
			},
		};
		const projection = [workStarted("session-1"), agentEvent].reduce(
			(current, event) => reduceSessionHistoryEvent(current, event),
			emptyProjection("session-1", "build"),
		);
		const html = renderSession(
			state({
				roster: [session],
				selectedSessionId: "session-1",
				projection,
			}),
		);

		expect(html).toContain("Prepare package");
		expect(html).toContain("bun run check");
		// Room-specific: the loop-pulse strip surfaces the run concurrency line,
		// and the right pane's agent-run panel surfaces the run id + stage.
		expect(html).toContain("runs");
		expect(html).toContain("agent run · run-1");
	});

	test("renders Operator Action confirm comment danger disabled and observer states", () => {
		const session = summary({ id: "session-1", workflowName: "review" });
		const event: SessionHistoryEvent = {
			...workStarted("session-1"),
			payload: {
				run: {
					workKey: "work:alpha",
					runId: "run-1",
					sourceId: "source",
					display: { title: "Needs operator" },
					operatorActions: [
						{
							id: "ship",
							label: "Ship",
							tone: "danger",
							requiresComment: true,
							confirm: { title: "Ship now?", message: "This is final." },
						},
						{ id: "hold", label: "Hold", disabledReason: "not ready" },
					],
				},
			},
		};
		const projection = applySnapshot(
			reduceSessionHistoryEvent(emptyProjection("session-1", "review"), event),
			{
				snapshot: {
					work: new Map([
						[
							"work:alpha",
							{
								workKey: "work:alpha",
								sourceId: "source",
								status: "blocked",
								display: { title: "Needs operator" },
								blockedReason: "waiting for operator",
								operatorActions: [
									{
										id: "ship",
										label: "Ship",
										tone: "danger",
										requiresComment: true,
										confirm: {
											title: "Ship now?",
											message: "This is final.",
										},
									},
									{
										id: "hold",
										label: "Hold",
										disabledReason: "not ready",
									},
								],
								currentRunId: "run-1",
							},
						],
					]),
					running: new Map([
						[
							"work:alpha",
							{ workKey: "work:alpha", runId: "run-1", sourceId: "source" },
						],
					]),
				},
			},
		);
		const html = renderSession(
			state({
				controlRole: "observer",
				roster: [session],
				selectedSessionId: "session-1",
				projection,
			}),
		);

		expect(html).toContain("Ship");
		expect(html).toContain("Hold");
		expect(html).toContain("not ready");
		expect(html).toContain("controller required");
	});

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

	test("a failed work item surfaces its completed failure message", () => {
		const session = summary({ id: "session-1", workflowName: "review" });
		const base = reduceSessionHistoryEvent(
			emptyProjection("session-1", "review"),
			workStarted("session-1"),
		);
		// A failed work row carries no live activity (its attempt is gone), so the
		// failure box must read the matching `completed` entry's `message`.
		const projection = applySnapshot(
			{
				...base,
				completed: [
					{
						workKey: "work:alpha",
						label: "Prepare package",
						status: "failed",
						message: "check failed: bun run check exited 1",
						atMs: 1,
					},
				],
			},
			{
				snapshot: {
					work: new Map([
						[
							"work:alpha",
							{
								workKey: "work:alpha",
								sourceId: "source",
								status: "failed",
								display: { title: "Prepare package" },
								currentRunId: undefined,
							},
						],
					]),
					running: new Map(),
				},
			},
		);
		const html = renderSession(
			state({
				roster: [session],
				selectedSessionId: "session-1",
				projection,
			}),
		);
		expect(html).toContain("check failed: bun run check exited 1");
	});

	test("an error-state session stays legible in the lobby", () => {
		// An error session with needsYouCount 0 is NOT NEEDS YOU (locked decision
		// #5) and must not take the accent (locked #6) — but it must not read as a
		// silently-calm watching row either. Its `state` surfaces as neutral meta.
		const html = renderLobby(
			state({
				roster: [
					summary({ id: "down", workflowName: "deploy", state: "error" }),
				],
			}),
		);
		expect(html).toContain("watching");
		expect(html).toContain("deploy");
		expect(html).toContain("error");
	});

	test("extension-defined long strings render without breaking layout", () => {
		// Operator-action `label`, `disabledReason`, `model`, `workflowPath` are
		// extension-defined and unbounded. The Room must render long values without
		// crashing; truncation itself is CSS (asserted by class, not measured here).
		const longLabel =
			"Ship this very-long extension-defined operator action label that should never break the row layout";
		const longPath = `/very/deeply/nested/workspace/${"segment-".repeat(20)}WORKFLOW.md`;
		const session = summary({
			id: "session-1",
			workflowName: "review",
			workflowPath: longPath,
		});
		const event: SessionHistoryEvent = {
			...workStarted("session-1"),
			payload: {
				run: {
					workKey: "work:alpha",
					runId: "run-1",
					sourceId: "source",
					display: { title: "Needs operator" },
					operatorActions: [
						{ id: "ship", label: longLabel, disabledReason: longPath },
					],
				},
			},
		};
		const projection = applySnapshot(
			reduceSessionHistoryEvent(emptyProjection("session-1", "review"), event),
			{
				snapshot: {
					work: new Map([
						[
							"work:alpha",
							{
								workKey: "work:alpha",
								sourceId: "source",
								status: "blocked",
								display: { title: "Needs operator" },
								blockedReason: "waiting for operator",
								operatorActions: [
									{ id: "ship", label: longLabel, disabledReason: longPath },
								],
								currentRunId: "run-1",
							},
						],
					]),
					running: new Map([
						[
							"work:alpha",
							{ workKey: "work:alpha", runId: "run-1", sourceId: "source" },
						],
					]),
				},
			},
		);
		const html = renderSession(
			state({
				roster: [session],
				selectedSessionId: "session-1",
				projection,
			}),
		);
		expect(html).toContain(longLabel);
		expect(html).toContain("Needs operator");
	});

	test("offline state preserves the last good frame", () => {
		const session = summary({ id: "session-1", workflowName: "docs" });
		const projection = reduceSessionHistoryEvent(
			emptyProjection("session-1", "docs"),
			workStarted("session-1"),
		);
		const offlineState = state({
			connection: "offline",
			lastError: "Local Plot Server connection closed",
			roster: [session],
			selectedSessionId: "session-1",
			projection,
		});
		// The persisted frame stays in the session route; the Room top bar now
		// surfaces the degraded connection too, so it reads `offline · last frame`
		// alongside the preserved frame.
		const sessionHtml = renderSession(offlineState);
		expect(sessionHtml).toContain("Prepare package");
		expect(sessionHtml).toContain("offline · last frame");
		expect(renderLobby(offlineState)).toContain("offline · last frame");
	});
});
