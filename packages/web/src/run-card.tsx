import { createContext, use } from "react";
import type { ReactNode } from "react";
import { Badge } from "./components/ui/badge.js";
import {
	Card,
	CardHeader,
	CardPanel,
	CardTitle,
} from "./components/ui/card.js";
import {
	Tooltip,
	TooltipPopup,
	TooltipProvider,
	TooltipTrigger,
} from "./components/ui/tooltip.js";
import type { RunLiveState } from "./live-events.js";
import type { PlotRun } from "./run.js";

interface RunCardState {
	readonly run: PlotRun;
	readonly live?: RunLiveState | undefined;
}

interface RunCardContextValue {
	readonly state: RunCardState;
	readonly actions: Record<string, never>;
	readonly meta: Record<string, never>;
}

const RunCardContext = createContext<RunCardContextValue | null>(null);

const useRunCard = (): RunCardContextValue => {
	const value = use(RunCardContext);
	if (value === null) throw new Error("RunCardContext missing");
	return value;
};

const formatHeartbeat = (value: string) => {
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) return value;
	const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
	return seconds < 2 ? "now" : `${seconds}s ago`;
};

function Provider({
	children,
	live,
	run,
}: {
	readonly children: ReactNode;
	readonly live?: RunLiveState | undefined;
	readonly run: PlotRun;
}) {
	return (
		<RunCardContext value={{ state: { run, live }, actions: {}, meta: {} }}>
			{children}
		</RunCardContext>
	);
}

function Frame({ children }: { readonly children: ReactNode }) {
	return <Card className="plot-session-card">{children}</Card>;
}

function Header({ children }: { readonly children: ReactNode }) {
	return (
		<CardHeader className="plot-session-card-header">{children}</CardHeader>
	);
}

function Identity() {
	const {
		state: { run },
	} = useRunCard();
	return (
		<div className="plot-session-card-identity">
			<CardTitle className="plot-session-card-title">
				{run.workflowName ?? run.sessionId ?? run.id}
			</CardTitle>
			<p className="plot-session-card-subtitle">{run.cwdName ?? run.cwd}</p>
		</div>
	);
}

function StatusBadge() {
	const {
		state: { run },
	} = useRunCard();
	return <Badge variant="outline">{run.status}</Badge>;
}

function Facts({ children }: { readonly children: ReactNode }) {
	return <CardPanel className="plot-session-card-facts">{children}</CardPanel>;
}

function Fact(props: {
	readonly label: string;
	readonly title?: string | undefined;
	readonly value: string;
}) {
	const value = <div className="plot-fact-value">{props.value}</div>;
	return (
		<div className="plot-fact">
			<div className="plot-fact-label">{props.label}</div>
			{props.title === undefined ? (
				value
			) : (
				<Tooltip>
					<TooltipTrigger render={<div className="plot-fact-value" />}>
						{props.value}
					</TooltipTrigger>
					<TooltipPopup>{props.title}</TooltipPopup>
				</Tooltip>
			)}
		</div>
	);
}

function RunIdFact() {
	const {
		state: { run },
	} = useRunCard();
	return <Fact label="run" value={run.id} title={run.sessionId ?? run.id} />;
}

function LastEventFact() {
	const {
		state: { live, run },
	} = useRunCard();
	return (
		<Fact
			label="last"
			value={`${live?.lastType ?? run.lastEventType ?? "started"} #${live?.frontier ?? run.lastSequence ?? 0}`}
		/>
	);
}

function StreamFact() {
	const {
		state: { live },
	} = useRunCard();
	return (
		<Fact
			label="stream"
			value={live === undefined ? "connecting" : `${live.eventCount} event(s)`}
		/>
	);
}

function SeenFact() {
	const {
		state: { run },
	} = useRunCard();
	return (
		<Fact
			label="seen"
			value={formatHeartbeat(run.lastSeenAt ?? run.createdAt)}
		/>
	);
}

function CwdFact() {
	const {
		state: { run },
	} = useRunCard();
	return <Fact label="cwd" value={run.cwd} title={run.cwd} />;
}

const RunCard = {
	Provider,
	Frame,
	Header,
	Identity,
	StatusBadge,
	Facts,
	RunIdFact,
	LastEventFact,
	StreamFact,
	SeenFact,
	CwdFact,
};

export function RunCardView(props: {
	readonly live?: RunLiveState | undefined;
	readonly run: PlotRun;
}) {
	return (
		<TooltipProvider>
			<RunCard.Provider run={props.run} live={props.live}>
				<RunCard.Frame>
					<RunCard.Header>
						<RunCard.Identity />
						<RunCard.StatusBadge />
					</RunCard.Header>
					<RunCard.Facts>
						<RunCard.RunIdFact />
						<RunCard.LastEventFact />
						<RunCard.StreamFact />
						<RunCard.SeenFact />
						<RunCard.CwdFact />
					</RunCard.Facts>
				</RunCard.Frame>
			</RunCard.Provider>
		</TooltipProvider>
	);
}
