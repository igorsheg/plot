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
import type { SessionLiveState } from "./live-events.js";
import type { PlotInstance } from "./instance.js";

interface InstanceCardState {
	readonly instance: PlotInstance;
	readonly live?: SessionLiveState | undefined;
}

interface InstanceCardContextValue {
	readonly state: InstanceCardState;
	readonly actions: Record<string, never>;
	readonly meta: Record<string, never>;
}

const InstanceCardContext = createContext<InstanceCardContextValue | null>(
	null,
);

const useInstanceCard = (): InstanceCardContextValue => {
	const value = use(InstanceCardContext);
	if (value === null) throw new Error("InstanceCardContext missing");
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
	instance,
}: {
	readonly children: ReactNode;
	readonly live?: SessionLiveState | undefined;
	readonly instance: PlotInstance;
}) {
	return (
		<InstanceCardContext
			value={{ state: { instance, live }, actions: {}, meta: {} }}
		>
			{children}
		</InstanceCardContext>
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
		state: { instance },
	} = useInstanceCard();
	return (
		<div className="plot-session-card-identity">
			<CardTitle className="plot-session-card-title">
				{instance.workflowName ?? instance.sessionId ?? instance.id}
			</CardTitle>
			<p className="plot-session-card-subtitle">
				{instance.cwdName ?? instance.cwd}
			</p>
		</div>
	);
}

function StatusBadge() {
	const {
		state: { instance },
	} = useInstanceCard();
	return <Badge variant="outline">{instance.status}</Badge>;
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

function SessionIdFact() {
	const {
		state: { instance },
	} = useInstanceCard();
	return (
		<Fact
			label="session"
			value={instance.sessionId ?? instance.id}
			title={instance.sessionId ?? instance.id}
		/>
	);
}

function LastEventFact() {
	const {
		state: { live, instance },
	} = useInstanceCard();
	return (
		<Fact
			label="last"
			value={`${live?.lastType ?? instance.lastEventType ?? "started"} #${live?.frontier ?? instance.lastSequence ?? 0}`}
		/>
	);
}

function StreamFact() {
	const {
		state: { live },
	} = useInstanceCard();
	return (
		<Fact
			label="stream"
			value={live === undefined ? "connecting" : `${live.eventCount} event(s)`}
		/>
	);
}

function SeenFact() {
	const {
		state: { instance },
	} = useInstanceCard();
	return (
		<Fact
			label="seen"
			value={formatHeartbeat(instance.lastSeenAt ?? instance.createdAt)}
		/>
	);
}

function CwdFact() {
	const {
		state: { instance },
	} = useInstanceCard();
	return <Fact label="cwd" value={instance.cwd} title={instance.cwd} />;
}

const InstanceCard = {
	Provider,
	Frame,
	Header,
	Identity,
	StatusBadge,
	Facts,
	SessionIdFact,
	LastEventFact,
	StreamFact,
	SeenFact,
	CwdFact,
};

export function FleetInstanceCard(props: {
	readonly live?: SessionLiveState | undefined;
	readonly instance: PlotInstance;
}) {
	return (
		<TooltipProvider>
			<InstanceCard.Provider instance={props.instance} live={props.live}>
				<InstanceCard.Frame>
					<InstanceCard.Header>
						<InstanceCard.Identity />
						<InstanceCard.StatusBadge />
					</InstanceCard.Header>
					<InstanceCard.Facts>
						<InstanceCard.SessionIdFact />
						<InstanceCard.LastEventFact />
						<InstanceCard.StreamFact />
						<InstanceCard.SeenFact />
						<InstanceCard.CwdFact />
					</InstanceCard.Facts>
				</InstanceCard.Frame>
			</InstanceCard.Provider>
		</TooltipProvider>
	);
}
