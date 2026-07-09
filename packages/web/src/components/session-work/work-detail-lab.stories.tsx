import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import type { WorkState } from "../ui/icons.js";
import { ArrowUpRightIcon, XIcon } from "../ui/icons.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import Stack, { VStack } from "../ui/stack.js";
import { StreamedProse } from "../ui/streamed.js";
import { Text } from "../ui/text.js";
import { StateIcon } from "./atoms.js";

/**
 * Lab: the work detail as a stable instrument panel. The masthead — identity,
 * status, and decision controls — stays pinned, while the narrative and event
 * ticker share the scroll below. So the things you act on never move, even as
 * the log grows.
 */
const meta = {
	title: "Work/Work Detail — Lab",
	parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

type Kind = "decision" | "active" | "settled" | "failed";
type Check = "running" | "passed" | "failed";

interface ActionSpec {
	readonly label: string;
	readonly tone: "primary" | "danger";
}

interface Metrics {
	readonly turn: number;
	readonly tokens: number;
	readonly cost: number | undefined;
	readonly elapsed: string;
}

interface EventEntry {
	readonly kind: string;
	readonly text: string;
	readonly time: string;
}

interface DetailModel {
	readonly kind: Kind;
	readonly state: WorkState;
	readonly title: string;
	readonly subtitle: string;
	readonly labels: readonly string[];
	readonly url: string | undefined;
	readonly stage: string;
	readonly check: Check | undefined;
	readonly now: string | undefined;
	readonly reason: string | undefined;
	readonly actions: readonly ActionSpec[];
	readonly message: string | undefined;
	readonly stream?: string;
	readonly metrics: Metrics;
	readonly events: readonly EventEntry[];
}

const fmtTokens = (n: number): string =>
	n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const CHECK: Record<
	Check,
	{ word: string; tone: "mono-secondary" | "mono-error" }
> = {
	running: { word: "verifying", tone: "mono-secondary" },
	passed: { word: "verify passed", tone: "mono-secondary" },
	failed: { word: "verify failed", tone: "mono-error" },
};

// --- regions ---------------------------------------------------------------

function Rail({ children }: { readonly children: ReactNode }) {
	return (
		<Text as="span" variant="mono-secondary" size="sm">
			{children}
		</Text>
	);
}

function Identity({ model }: { readonly model: DetailModel }) {
	return (
		<Stack alignCenter gap={8} wrap>
			<Text as="span" variant="mono-secondary" size="sm">
				{model.subtitle}
			</Text>
			{model.labels.map((label) => (
				<Badge key={label} variant="secondary">
					{label}
				</Badge>
			))}
			{model.url !== undefined && (
				<a
					className="ms-auto inline-flex items-center gap-1 rounded-sm font-mono text-muted-foreground text-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline"
					href={model.url}
					rel="noreferrer"
					target="_blank"
				>
					open
					<ArrowUpRightIcon className="size-3.5" />
				</a>
			)}
		</Stack>
	);
}

function Status({ model }: { readonly model: DetailModel }) {
	const check = model.check === undefined ? undefined : CHECK[model.check];
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-baseline gap-2">
				<Rail>{model.stage}</Rail>
				{check !== undefined && (
					<>
						<Rail>·</Rail>
						<Text as="span" size="sm" variant={check.tone}>
							{check.word}
						</Text>
					</>
				)}
			</div>
		</div>
	);
}

/** The one activity view: a dense ring buffer of the latest events. */
function Ticker({ events }: { readonly events: readonly EventEntry[] }) {
	if (events.length === 0) return null;
	const shown = events.slice(-6);
	return (
		<div className="flex flex-col gap-1">
			{shown.map((event, index) => (
				<div className="flex items-baseline gap-3" key={index}>
					<span className="w-12 shrink-0">
						<Text as="span" variant="mono-secondary" size="sm">
							{event.kind}
						</Text>
					</span>
					<Text
						as="p"
						size="sm"
						truncate
						variant={index === shown.length - 1 ? "mono" : "mono-secondary"}
					>
						{event.text}
					</Text>
					<span className="ms-auto shrink-0 ps-3">
						<Text as="span" variant="mono-secondary" size="sm">
							{event.time}
						</Text>
					</span>
				</div>
			))}
		</div>
	);
}

/** The decision controls, pinned in the masthead so they never shift as the
 *  narrative below them grows. */
function Actions({ model }: { readonly model: DetailModel }) {
	return (
		<Stack alignCenter gap={8} wrap>
			{model.actions.map((action) => (
				<Button
					key={action.label}
					size="sm"
					variant={action.tone === "danger" ? "destructive-outline" : "outline"}
				>
					{action.label}
				</Button>
			))}
			<Button size="sm" variant="ghost">
				comment…
			</Button>
		</Stack>
	);
}

/** The semantic narrative — a decision's reason, or a settled/failed outcome.
 *  Shares the scroll region with the ticker, free to grow. */
function Narrative({ model }: { readonly model: DetailModel }) {
	if (model.kind === "decision") {
		return model.reason === undefined ? null : (
			<StreamedProse text={model.reason} />
		);
	}
	if (model.message === undefined) return null;
	return model.kind === "failed" ? (
		<StreamedProse text={model.message} tone="danger" />
	) : (
		<StreamedProse text={model.message} />
	);
}

function Metrics({ metrics }: { readonly metrics: Metrics }) {
	const parts = [
		`turn ${metrics.turn}`,
		`${fmtTokens(metrics.tokens)} tok`,
		metrics.cost === undefined ? undefined : `$${metrics.cost.toFixed(2)}`,
		metrics.elapsed,
	].filter((part): part is string => part !== undefined);
	return (
		<Text as="span" variant="mono-secondary" size="sm">
			{parts.join("  ·  ")}
		</Text>
	);
}

function Detail({ model }: { readonly model: DetailModel }) {
	return (
		<VStack style={{ height: "100%" }}>
			{/* masthead — identity, status, and controls stay pinned and stable */}
			<VStack gap={12} style={{ padding: "20px 24px 16px" }}>
				<Stack alignStart between gap={12}>
					<Stack alignCenter gap={8} style={{ minWidth: 0 }}>
						<StateIcon state={model.state} />
						<Text as="h2" variant="heading3" truncate>
							{model.title}
						</Text>
					</Stack>
					<Button aria-label="Close" size="icon" variant="ghost">
						<XIcon aria-hidden />
					</Button>
				</Stack>
				<Identity model={model} />
				<Status model={model} />
				{model.kind === "decision" && <Actions model={model} />}
			</VStack>
			{/* log — narrative and ticker share the rest, free to grow and scroll */}
			<VStack
				gap={20}
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: "auto",
					padding: "4px 24px 24px",
				}}
			>
				<Narrative model={model} />
				<Ticker events={model.events} />
			</VStack>
			<Stack
				alignCenter
				between
				gap={12}
				style={{ padding: "12px 24px", borderTop: "1px solid var(--border)" }}
			>
				<Metrics metrics={model.metrics} />
				<Text as="span" variant="mono-secondary" size="sm">
					esc to close
				</Text>
			</Stack>
		</VStack>
	);
}

// --- models ----------------------------------------------------------------

const DECISION: DetailModel = {
	kind: "decision",
	state: "attention",
	title: "Approve deploy to staging?",
	subtitle: "vercel/next.js #402",
	labels: ["deploy", "p1"],
	url: "https://github.com/vercel/next.js/pull/402",
	stage: "blocked",
	check: "passed",
	now: "verified all three checks",
	reason:
		"Verification passed on all three checks — lint, type-check, and the full unit suite (42 tests). The build is reproducible and the diff touches only the message-pump module, so the blast radius is small. Approve to promote the build to staging, where it runs against the integration environment for ten minutes before the canary. Reject to hold it here and let the workflow retry from a fresh attempt. Or leave a comment to send guidance back to the agent — it folds your note into the next turn. Nothing ships until you choose.",
	actions: [
		{ label: "Approve", tone: "primary" },
		{ label: "Reject", tone: "danger" },
	],
	message: undefined,
	metrics: { turn: 5, tokens: 48_300, cost: 0.42, elapsed: "2m" },
	events: [
		{ kind: "read", text: "PR #402 description", time: "3m" },
		{ kind: "read", text: "the diff — 12 files", time: "3m" },
		{ kind: "test", text: "lint · type · unit", time: "2m" },
		{ kind: "test", text: "all checks passed", time: "2m" },
		{ kind: "wait", text: "awaiting operator", time: "2m" },
	],
};

const ACTIVE: DetailModel = {
	kind: "active",
	state: "active",
	title: "Refactor the host message pump",
	subtitle: "packages/session",
	labels: ["refactor"],
	url: undefined,
	stage: "working",
	check: "running",
	now: "editing packages/session/src/host.ts",
	reason: undefined,
	actions: [],
	message: undefined,
	stream:
		"Extracting the dispatch loop into a standalone `reducer` so the transport can be swapped without touching the state machine. Next I'll wire it into the pump and re-run the host tests.",
	metrics: { turn: 3, tokens: 12_000, cost: 0.08, elapsed: "24s" },
	events: [
		{ kind: "read", text: "host.ts · protocol.ts", time: "1m" },
		{ kind: "search", text: "dispatch call sites", time: "50s" },
		{ kind: "edit", text: "extract dispatch()", time: "40s" },
		{ kind: "edit", text: "wire reducer into pump", time: "25s" },
		{ kind: "edit", text: "host.ts message pump", time: "now" },
	],
};

const SETTLED: DetailModel = {
	kind: "settled",
	state: "done",
	title: "committed refine host message pump",
	subtitle: "c634736",
	labels: ["merged"],
	url: "https://github.com/plot/plot/commit/c634736",
	stage: "done",
	check: "passed",
	now: undefined,
	reason: undefined,
	actions: [],
	message: "Committed the message-pump refactor. 6 files changed, tests green.",
	metrics: { turn: 8, tokens: 86_000, cost: 0.61, elapsed: "1m 04s" },
	events: [
		{ kind: "read", text: "host.ts", time: "8m" },
		{ kind: "edit", text: "6 files", time: "5m" },
		{ kind: "test", text: "host.test.ts", time: "2m" },
		{ kind: "test", text: "42 passing", time: "1m" },
		{ kind: "finish", text: "committed c634736", time: "just now" },
	],
};

const FAILED: DetailModel = {
	kind: "failed",
	state: "canceled",
	title: "verify step failed",
	subtitle: "host.test.ts:42",
	labels: ["ci"],
	url: undefined,
	stage: "failed",
	check: "failed",
	now: undefined,
	reason: undefined,
	actions: [],
	message:
		"AssertionError: expected 200, received 500 — the gateway returned an error before the session was ready.",
	metrics: { turn: 2, tokens: 9_000, cost: undefined, elapsed: "1m" },
	events: [
		{ kind: "read", text: "host.ts", time: "2m" },
		{ kind: "run", text: "bun test test/host.test.ts", time: "1m" },
		{ kind: "test", text: "1 assertion failed", time: "1m" },
	],
};

function panel(model: DetailModel): StoryObj {
	return {
		render: () => (
			<div
				style={{
					width: 460,
					height: 640,
					overflow: "hidden",
					border: "1px solid var(--border)",
					borderRadius: 14,
					background: "var(--background)",
				}}
			>
				<Detail model={model} />
			</div>
		),
	};
}

export const Decision = panel(DECISION);
export const Active = panel(ACTIVE);
export const Settled = panel(SETTLED);
export const Failed = panel(FAILED);
