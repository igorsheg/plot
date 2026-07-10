/**
 * Session header — identity above, a live ledger below. Row one is the title
 * and the Stop action; row two is the run's kicker (a config popover trigger)
 * on the left and the cumulative token/cost ledger with the live throughput
 * spark on the right. The root selects an explicit variant by status; every
 * variant consumes only `useSessionHeader()`.
 */

import { useStore } from "@nanostores/react";
import type { RunStatus } from "@plot/registry/record";
import type { ReactNode } from "react";
import { $stopSelectedRun, stopSelectedRun } from "../../app/actions-store.js";
import { $selectedProjection } from "../../app/projection-store.js";
import { $selectedRun, displayName } from "../../app/runs-store.js";
import { $nowMs } from "../../app/time-store.js";
import { formatRelative } from "../../lib/relative-time.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover.js";
import Stack, { VStack } from "../ui/stack.js";
import { Text } from "../ui/text.js";
import {
	SessionHeaderProvider,
	useSessionHeader,
	type SessionConfig,
	type SessionHeaderContextValue,
	type SessionHeaderState,
	type SessionUsage,
} from "./context.js";
import { formatTps, tokenThroughput } from "./throughput.js";
import { ThroughputSparkline } from "./throughput-sparkline.js";

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

const fmtTokens = (n: number): string =>
	n >= 1_000_000
		? `${(n / 1_000_000).toFixed(1)}M`
		: n >= 1000
			? `${(n / 1000).toFixed(1)}k`
			: String(n);

const fmtCost = (n: number): string => `$${n.toFixed(2)}`;

const fmtDuration = (ms: number): string =>
	ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`;

const tallyText = (usage: SessionUsage): string =>
	usage.cost === undefined
		? fmtTokens(usage.tokens)
		: `${fmtTokens(usage.tokens)} · ${fmtCost(usage.cost)}`;

// --- config popover -------------------------------------------------------

const loopParts = (config: SessionConfig): string => {
	const parts: string[] = [];
	if (config.tickIntervalMs !== undefined)
		parts.push(`tick ${fmtDuration(config.tickIntervalMs)}`);
	if (config.maxConcurrentRuns !== undefined)
		parts.push(`${config.maxConcurrentRuns} concurrent`);
	if (config.maxRunDurationMs !== undefined)
		parts.push(`${fmtDuration(config.maxRunDurationMs)} max`);
	if (config.pid !== undefined) parts.push(`pid ${config.pid}`);
	return parts.join(" · ");
};

/** One key/value row: label in a fixed gutter, value aligned in a column. */
function MetaRow({
	label,
	children,
}: {
	readonly label: string;
	readonly children: ReactNode;
}) {
	return (
		<Stack align="flex-start" gap={12}>
			<span style={{ width: 80, flexShrink: 0 }}>
				<Text as="span" variant="mono-secondary" size="sm">
					{label}
				</Text>
			</span>
			<div style={{ flex: 1, minWidth: 0 }}>{children}</div>
		</Stack>
	);
}

function Kicker({
	state,
	withStarted,
}: {
	readonly state: SessionHeaderState;
	readonly withStarted: boolean;
}) {
	const started =
		withStarted && state.startedAtMs !== undefined
			? formatRelative(state.startedAtMs, state.nowMs)
			: undefined;
	return (
		<Text as="span" variant="secondary" size="sm">
			{state.place}
			{started !== undefined && ` · started ${started}`}
		</Text>
	);
}

function SessionMeta({
	state,
	withStarted = true,
}: {
	readonly state: SessionHeaderState;
	readonly withStarted?: boolean;
}) {
	const { config } = state;
	const kicker = <Kicker state={state} withStarted={withStarted} />;
	const loop = loopParts(config);
	return (
		<Popover>
			<PopoverTrigger className="cursor-pointer rounded-sm text-left underline-offset-2 outline-none hover:underline focus-visible:underline">
				{kicker}
			</PopoverTrigger>
			<PopoverPopup align="start" sideOffset={8} className="w-80">
				<VStack gap={12}>
					{config.model !== undefined && (
						<MetaRow label="model">
							<Text as="span" variant="mono" size="sm">
								{config.provider === undefined
									? config.model
									: `${config.model} · ${config.provider}`}
							</Text>
						</MetaRow>
					)}
					<MetaRow label="workflow">
						<VStack gap={2}>
							<Text as="p" variant="mono" size="sm">
								{config.workflow}
							</Text>
							{config.workflowPath !== undefined && (
								<Text as="p" variant="mono-secondary" size="sm" truncate>
									{config.workflowPath}
								</Text>
							)}
						</VStack>
					</MetaRow>
					{config.cwd.length > 0 && (
						<MetaRow label="cwd">
							<Text as="p" variant="mono-secondary" size="sm" truncate>
								{config.cwd}
							</Text>
						</MetaRow>
					)}
					{config.skills.length > 0 && (
						<MetaRow label="skills">
							<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
								{config.skills.map((skill) => (
									<Badge key={skill}>{skill}</Badge>
								))}
							</div>
						</MetaRow>
					)}
					{loop.length > 0 && (
						<>
							<div className="border-border border-t" />
							<Text as="p" variant="mono-secondary" size="xs">
								{loop}
							</Text>
						</>
					)}
				</VStack>
			</PopoverPopup>
		</Popover>
	);
}

// --- ledger ---------------------------------------------------------------

/** Live: cumulative tally, the instantaneous rate, and the growing spark. */
function LiveLedger() {
	const { state } = useSessionHeader();
	return (
		<Stack align="baseline" gap={12}>
			<Text as="span" variant="mono-secondary" size="sm">
				{tallyText(state.usage)} · {formatTps(state.throughputRate)} tok/s
			</Text>
			<ThroughputSparkline graph={state.throughputGraph} />
		</Stack>
	);
}

/** Terminal states: the final tally only — no live rate, no spark. */
function FinalTally() {
	const { state } = useSessionHeader();
	if (state.usage.tokens <= 0) return null;
	return (
		<Text as="span" variant="mono-secondary" size="sm">
			{tallyText(state.usage)}
		</Text>
	);
}

// --- status chip ----------------------------------------------------------

const STATUS_WORD: Partial<Record<RunStatus, string>> = {
	starting: "starting…",
	stopping: "stopping…",
	stopped: "stopped",
	error: "errored",
};

function Sep() {
	return (
		<Text as="span" variant="secondary" size="sm">
			·
		</Text>
	);
}

/**
 * The run's status, inline after the kicker. Errored discloses its stderr in a
 * popover — the same disclosure model as the config popover beside it.
 */
function StatusChip({ state }: { readonly state: SessionHeaderState }) {
	const word = STATUS_WORD[state.status];
	if (word === undefined) return null;
	if (state.status === "error" && state.stderrTail !== undefined) {
		return (
			<>
				<Sep />
				<Popover>
					<PopoverTrigger className="cursor-pointer rounded-sm underline-offset-2 outline-none hover:underline focus-visible:underline">
						<Text as="span" variant="error" size="sm">
							{word}
						</Text>
					</PopoverTrigger>
					<PopoverPopup align="start" sideOffset={8} className="w-80">
						<VStack gap={8}>
							<Text as="span" variant="mono-secondary" size="sm">
								stderr
							</Text>
							<pre className="m-0 max-w-full whitespace-pre-wrap break-words font-mono text-foreground text-sm">
								{state.stderrTail}
							</pre>
						</VStack>
					</PopoverPopup>
				</Popover>
			</>
		);
	}
	return (
		<>
			<Sep />
			<Text
				as="span"
				size="sm"
				variant={state.status === "error" ? "error" : "secondary"}
			>
				{word}
			</Text>
		</>
	);
}

// --- shell + variants -----------------------------------------------------

function Shell({
	stop,
	ledger,
	withStarted = true,
}: {
	readonly stop?:
		| { readonly onStop: () => void; readonly stopping: boolean }
		| undefined;
	readonly ledger?: ReactNode;
	readonly withStarted?: boolean;
}) {
	const { state } = useSessionHeader();
	return (
		<VStack as="header" gap={24}>
			<Stack align="center" gap={16} justify="space-between" wrap>
				<Text as="h1" variant="heading1">
					{state.title}
				</Text>
				{stop !== undefined && (
					<Button
						disabled={stop.stopping}
						onClick={stop.onStop}
						size="sm"
						variant="outline"
					>
						Stop
					</Button>
				)}
			</Stack>
			{/* baseline so the kicker and the ledger text share a baseline even
			 * when the sparkline grows the row's height. */}
			<Stack align="baseline" gap={16} justify="space-between">
				<Stack align="baseline" gap={4}>
					<SessionMeta state={state} withStarted={withStarted} />
					<StatusChip state={state} />
				</Stack>
				{ledger}
			</Stack>
		</VStack>
	);
}

export function SessionHeader() {
	const { state, actions } = useSessionHeader();
	const variant = headerVariant(state.status);
	return (
		<Shell
			ledger={
				variant === "live" ? (
					<LiveLedger />
				) : variant === "starting" ? undefined : (
					<FinalTally />
				)
			}
			stop={
				variant === "live" && state.status !== "stopping"
					? { onStop: actions.stop, stopping: actions.stopping }
					: undefined
			}
			withStarted={variant !== "starting"}
		/>
	);
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
	const nowMs = useStore($nowMs);
	const throughput = tokenThroughput(projection, nowMs);
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
			throughputGraph: throughput.graph,
			throughputRate: throughput.rate,
			stderrTail: run.stderrTail,
			usage: {
				tokens: projection?.usageTotals.tokens ?? 0,
				cost: projection?.usageTotals.cost,
			},
			config: {
				model: projection?.runtime.model,
				provider: projection?.runtime.provider,
				workflow: projection?.workflowName ?? displayName(run),
				workflowPath: projection?.runtime.workflowPath ?? run.workflowPath,
				cwd: projection?.runtime.cwd ?? run.cwd,
				skills: projection?.runtime.skills ?? [],
				tickIntervalMs: projection?.runtime.tickIntervalMs,
				maxConcurrentRuns: projection?.runtime.maxConcurrentRuns,
				maxRunDurationMs: projection?.runtime.maxRunDurationMs,
				pid: run.pid,
			},
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
