/**
 * Session header — "liveness, not labels". A borderless band: kicker (place +
 * relative start), title with a quiet inline status word when transitioning,
 * and a 40px live strip whose motion (or stillness) is the status signal.
 *
 * The root selects an explicit variant by status; there are no boolean mode
 * props. Every variant consumes only `useSessionHeader()`.
 */

import { useStore } from "@nanostores/react";
import type { RunStatus } from "@plot/registry/record";
import type { ReactNode } from "react";
import { $stopSelectedRun, stopSelectedRun } from "../../app/actions-store.js";
import { $selectedProjection } from "../../app/projection-store.js";
import { $selectedRun, displayName } from "../../app/runs-store.js";
import { $nowMs } from "../../app/time-store.js";
import { formatRelative } from "../../lib/relative-time.js";
import { Button } from "../ui/button.js";
import { LiveLineChart } from "../ui/live-line/live-line-chart.js";
import { LiveLine } from "../ui/live-line/live-line.js";
import Stack, { VStack } from "../ui/stack.js";
import { Text } from "../ui/text.js";
import {
	SessionHeaderProvider,
	useSessionHeader,
	type SessionHeaderContextValue,
	type SessionHeaderState,
} from "./context.js";
import { $pulseRate, $pulseSeries } from "./pulse.js";

type HeaderVariant = "live" | "starting" | "errored" | "stopped";

/** Pure variant selection: online/stopping share the live band. */
export function headerVariant(status: RunStatus): HeaderVariant {
	switch (status) {
		case "starting":
			return "starting";
		case "error":
			return "errored";
		case "stopped":
			return "stopped";
		default:
			return "live";
	}
}

function Kicker({
	place,
	startedAtMs,
	nowMs,
	withStarted,
}: {
	readonly place: string;
	readonly startedAtMs: number | undefined;
	readonly nowMs: number;
	readonly withStarted: boolean;
}) {
	return (
		<Text as="p" variant="secondary" size="sm">
			{place}
			{withStarted && startedAtMs !== undefined && (
				<>
					{" · started "}
					<Text as="span" variant="mono-secondary">
						{formatRelative(startedAtMs, nowMs)}
					</Text>
				</>
			)}
		</Text>
	);
}

function LiveStrip({ state }: { readonly state: SessionHeaderState }) {
	return (
		<Stack baseline gap={12}>
			<div style={{ flex: "1 1 0%", minWidth: 0 }}>
				<LiveLineChart
					data={state.series}
					margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
					paused={state.status !== "online"}
					style={{ height: 40 }}
					value={state.rate}
					window={280}
				>
					<LiveLine
						badge={false}
						dataKey="value"
						dotSize={2.5}
						fill={false}
						guide={false}
						stroke="var(--text-color-kumo-subtle)"
					/>
				</LiveLineChart>
			</div>
			{state.lastEventAtMs !== undefined && (
				<Text as="span" variant="mono-secondary">
					last event {formatRelative(state.lastEventAtMs, state.nowMs)}
				</Text>
			)}
		</Stack>
	);
}

/** Height-matched placeholder so the band never jumps while starting. */
function GhostStrip() {
	return (
		<div
			aria-hidden="true"
			style={{ height: 40, opacity: 0.25, position: "relative" }}
		>
			<div
				style={{
					background: "var(--text-color-kumo-subtle)",
					height: 1.5,
					left: 0,
					position: "absolute",
					right: 0,
					top: 19,
				}}
			/>
		</div>
	);
}

function LiveSessionHeader() {
	const { state, actions } = useSessionHeader();
	const isStopping = state.status === "stopping";
	return (
		<VStack as="header" gap={12}>
			<Kicker
				nowMs={state.nowMs}
				place={state.place}
				startedAtMs={state.startedAtMs}
				withStarted
			/>
			<Stack alignCenter between gap={16} wrap>
				<Stack alignCenter gap={8} wrap>
					<Text as="h1" variant="heading1">
						{state.title}
					</Text>
					{isStopping && (
						<Text as="span" size="sm" variant="secondary">
							stopping…
						</Text>
					)}
				</Stack>
				{!isStopping && (
					<Button
						disabled={actions.stopping}
						onClick={actions.stop}
						size="sm"
						variant="outline"
					>
						Stop
					</Button>
				)}
			</Stack>
			<LiveStrip state={state} />
		</VStack>
	);
}

function StartingSessionHeader() {
	const { state } = useSessionHeader();
	return (
		<VStack as="header" gap={12}>
			<Kicker
				nowMs={state.nowMs}
				place={state.place}
				startedAtMs={state.startedAtMs}
				withStarted={false}
			/>
			<Stack alignCenter gap={8} wrap>
				<Text as="h1" variant="heading1">
					{state.title}
				</Text>
				<Text as="span" size="sm" variant="secondary">
					starting…
				</Text>
			</Stack>
			<GhostStrip />
		</VStack>
	);
}

function ErroredSessionHeader() {
	const { state } = useSessionHeader();
	return (
		<VStack as="header" gap={12}>
			<Kicker
				nowMs={state.nowMs}
				place={state.place}
				startedAtMs={state.startedAtMs}
				withStarted
			/>
			<Stack alignCenter gap={8} wrap>
				<Text as="h1" variant="heading1">
					{state.title}
				</Text>
				<Text as="span" size="sm" variant="error">
					errored
				</Text>
			</Stack>
			{state.stderrTail !== undefined && (
				<Text as="p" truncate variant="mono-secondary">
					{state.stderrTail}
				</Text>
			)}
		</VStack>
	);
}

/**
 * Read-only header for a stopped (past) session: no Stop button, no live strip.
 * The status word is quiet (secondary), not an alarm.
 */
function StoppedSessionHeader() {
	const { state } = useSessionHeader();
	return (
		<VStack as="header" gap={12}>
			<Kicker
				nowMs={state.nowMs}
				place={state.place}
				startedAtMs={state.startedAtMs}
				withStarted
			/>
			<Stack alignCenter gap={8} wrap>
				<Text as="h1" variant="heading1">
					{state.title}
				</Text>
				<Text as="span" size="sm" variant="secondary">
					stopped
				</Text>
			</Stack>
		</VStack>
	);
}

export function SessionHeader() {
	const { state } = useSessionHeader();
	switch (headerVariant(state.status)) {
		case "starting":
			return <StartingSessionHeader />;
		case "errored":
			return <ErroredSessionHeader />;
		case "stopped":
			return <StoppedSessionHeader />;
		default:
			return <LiveSessionHeader />;
	}
}

const parseTimeMs = (value: string | undefined): number | undefined => {
	if (value === undefined) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
};

/**
 * Adapts the app's nanostores into the generic header interface. This is the
 * only place the header touches app state; the variants below never do.
 */
export function StoreSessionHeaderProvider({
	children,
}: {
	readonly children: ReactNode;
}) {
	const run = useStore($selectedRun);
	const projection = useStore($selectedProjection);
	const series = useStore($pulseSeries);
	const rate = useStore($pulseRate);
	const nowMs = useStore($nowMs);
	const stopState = useStore($stopSelectedRun);
	if (run === undefined) return null;
	const value: SessionHeaderContextValue = {
		state: {
			place: run.cwdName ?? projection?.runtime.cwdName ?? "session",
			title: projection?.workflowName ?? displayName(run),
			status: run.status,
			startedAtMs: parseTimeMs(run.createdAt),
			lastEventAtMs: parseTimeMs(run.lastSeenAt),
			nowMs,
			series,
			rate,
			stderrTail: run.stderrTail,
		},
		actions: {
			stop: () => void stopSelectedRun(),
			stopping: stopState.loading ?? false,
		},
	};
	return (
		<SessionHeaderProvider value={value}>{children}</SessionHeaderProvider>
	);
}
