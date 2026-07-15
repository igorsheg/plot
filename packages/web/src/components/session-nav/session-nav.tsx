/**
 * The board shell chrome — selected Session identity on the left, the liveness
 * ledger and shell controls on the right, and a full-width band for Workflow
 * tabs. Layout selection stays in the top nav beside theme; tabs only change
 * Workflows.
 */

import type { SessionState } from "@plot/session-manager/session";
import type { ReactNode } from "react";
import { formatRelative } from "../../lib/relative-time.js";
import { useSessionHeader } from "../session-header/context.js";
import { ThroughputSparkline } from "../session-header/throughput-sparkline.js";
import { formatTps } from "../session-header/throughput.js";
import { Button } from "../ui/button.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Text } from "../ui/text.js";
import { cva } from "../ui/variants.js";

const rootClass = cva({
	base: "flex w-full items-center gap-4 border-b border-border bg-background px-[var(--plot-space-6)] py-[var(--plot-space-3)]",
});

const identityClass = cva({
	base: "flex min-w-0 flex-1 items-baseline gap-x-2",
});

const titleClass = cva({
	base: "min-w-0 shrink",
});

const metaClass = cva({
	base: "shrink-0 whitespace-nowrap",
});

const statusClass = cva({
	base: "shrink-0 whitespace-nowrap",
});

const ledgerClass = cva({
	base: "hidden shrink-0 items-baseline gap-3 sm:flex",
});

const actionsClass = cva({
	base: "flex shrink-0 items-center gap-1",
});

const bandClass = cva({
	base: "flex w-full items-center border-b border-border bg-background px-[var(--plot-space-6)] py-[var(--plot-space-2)]",
});

function Root({ children }: { readonly children: ReactNode }): ReactNode {
	return (
		<header className={rootClass()} data-slot="session-nav-root">
			{children}
		</header>
	);
}

function Identity({ children }: { readonly children: ReactNode }): ReactNode {
	return (
		<div className={identityClass()} data-slot="session-nav-identity">
			{children}
		</div>
	);
}

function Title({ children }: { readonly children: ReactNode }): ReactNode {
	return (
		<div className={titleClass()} data-slot="session-nav-title">
			<Text as="h1" truncate variant="heading3">
				{children}
			</Text>
		</div>
	);
}

function Meta({ children }: { readonly children: ReactNode }): ReactNode {
	return (
		<span className={metaClass()} data-slot="session-nav-meta">
			<Text as="span" variant="secondary" size="sm">
				{children}
			</Text>
		</span>
	);
}

function Status({
	children,
	tone = "secondary",
}: {
	readonly children: ReactNode;
	readonly tone?: "secondary" | "error";
}): ReactNode {
	return (
		<span className={statusClass()} data-slot="session-nav-status">
			<Text as="span" size="sm" variant={tone}>
				{"· "}
				{children}
			</Text>
		</span>
	);
}

function Ledger({ children }: { readonly children: ReactNode }): ReactNode {
	return (
		<span className={ledgerClass()} data-slot="session-nav-ledger">
			{children}
		</span>
	);
}

function Actions({ children }: { readonly children: ReactNode }): ReactNode {
	return (
		<div className={actionsClass()} data-slot="session-nav-actions">
			{children}
		</div>
	);
}

function Band({ children }: { readonly children: ReactNode }): ReactNode {
	return (
		<div className={bandClass()} data-slot="session-nav-band">
			<ScrollArea className="min-w-0" scrollFade scrollbarGutter>
				{children}
			</ScrollArea>
		</div>
	);
}

const statusWord: Partial<Record<SessionState, string>> = {
	starting: "starting…",
	stopping: "stopping…",
	stopped: "stopped",
	error: "errored",
};

const formatTokens = (value: number): string =>
	value >= 1_000_000
		? `${(value / 1_000_000).toFixed(1)}M`
		: value >= 1000
			? `${(value / 1000).toFixed(1)}k`
			: String(value);

const tally = (tokens: number, cost: number | undefined): string =>
	cost === undefined
		? formatTokens(tokens)
		: `${formatTokens(tokens)} · $${cost.toFixed(2)}`;

function NavLedger() {
	const { state } = useSessionHeader();
	if (state.status === "starting") return null;
	if (state.status === "stopped" || state.status === "error") {
		if (state.usage.tokens <= 0) return null;
		return (
			<Text as="span" size="sm" variant="mono-secondary">
				{tally(state.usage.tokens, state.usage.cost)}
			</Text>
		);
	}
	return (
		<>
			<Text as="span" size="sm" variant="mono-secondary">
				{tally(state.usage.tokens, state.usage.cost)} ·{" "}
				{formatTps(state.throughputRate)} tok/s
			</Text>
			<ThroughputSparkline graph={state.throughputGraph} height="control-sm" />
		</>
	);
}

/**
 * The generic header-context composition used by the board shell. Store wiring
 * stays in `StoreSessionHeaderProvider`; callers add shell-level controls as
 * children without teaching this composition about layout or theme stores.
 */
export function SessionNavHeader({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	const { state, actions } = useSessionHeader();
	const started =
		state.startedAtMs === undefined
			? undefined
			: formatRelative(state.startedAtMs, state.nowMs);
	const status = statusWord[state.status];
	return (
		<Root>
			<Identity>
				<Title>{state.title}</Title>
				<Meta>
					{state.place}
					{started !== undefined && ` · started ${started}`}
				</Meta>
				{status !== undefined && (
					<Status tone={state.status === "error" ? "error" : "secondary"}>
						{status}
					</Status>
				)}
			</Identity>
			<Ledger>
				<NavLedger />
			</Ledger>
			<Actions>
				{state.status === "online" && (
					<Button
						disabled={actions.stopping}
						onClick={actions.stop}
						size="sm"
						variant="outline"
					>
						Stop
					</Button>
				)}
				{children}
			</Actions>
		</Root>
	);
}

export const SessionNav = {
	Root,
	Identity,
	Title,
	Meta,
	Status,
	Ledger,
	Actions,
	Band,
} as const;
