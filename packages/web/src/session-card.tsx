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
import type { PlotSessionRegistration } from "./registration.js";

interface SessionCardState {
	readonly session: PlotSessionRegistration;
	readonly live?: SessionLiveState | undefined;
}

interface SessionCardContextValue {
	readonly state: SessionCardState;
	readonly actions: Record<string, never>;
	readonly meta: Record<string, never>;
}

const SessionCardContext = createContext<SessionCardContextValue | null>(null);

const useSessionCard = (): SessionCardContextValue => {
	const value = use(SessionCardContext);
	if (value === null) throw new Error("SessionCardContext missing");
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
	session,
}: {
	readonly children: ReactNode;
	readonly live?: SessionLiveState | undefined;
	readonly session: PlotSessionRegistration;
}) {
	return (
		<SessionCardContext
			value={{ state: { session, live }, actions: {}, meta: {} }}
		>
			{children}
		</SessionCardContext>
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
		state: { session },
	} = useSessionCard();
	return (
		<div className="plot-session-card-identity">
			<CardTitle className="plot-session-card-title">
				{session.workflowName}
			</CardTitle>
			<p className="plot-session-card-subtitle">{session.cwdName}</p>
		</div>
	);
}

function PidBadge() {
	const {
		state: { session },
	} = useSessionCard();
	return <Badge variant="outline">pid {session.pid}</Badge>;
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
		state: { session },
	} = useSessionCard();
	return (
		<Fact label="session" value={session.sessionId} title={session.sessionId} />
	);
}

function LastEventFact() {
	const {
		state: { live, session },
	} = useSessionCard();
	return (
		<Fact
			label="last"
			value={`${live?.lastType ?? session.lastEventType ?? "registered"} #${live?.frontier ?? session.lastSequence}`}
		/>
	);
}

function StreamFact() {
	const {
		state: { live },
	} = useSessionCard();
	return (
		<Fact
			label="stream"
			value={live === undefined ? "connecting" : `${live.eventCount} event(s)`}
		/>
	);
}

function SeenFact() {
	const {
		state: { session },
	} = useSessionCard();
	return <Fact label="seen" value={formatHeartbeat(session.heartbeatAt)} />;
}

function CwdFact() {
	const {
		state: { session },
	} = useSessionCard();
	return <Fact label="cwd" value={session.cwd} title={session.cwd} />;
}

const SessionCard = {
	Provider,
	Frame,
	Header,
	Identity,
	PidBadge,
	Facts,
	SessionIdFact,
	LastEventFact,
	StreamFact,
	SeenFact,
	CwdFact,
};

export function FleetSessionCard(props: {
	readonly live?: SessionLiveState | undefined;
	readonly session: PlotSessionRegistration;
}) {
	return (
		<TooltipProvider>
			<SessionCard.Provider session={props.session} live={props.live}>
				<SessionCard.Frame>
					<SessionCard.Header>
						<SessionCard.Identity />
						<SessionCard.PidBadge />
					</SessionCard.Header>
					<SessionCard.Facts>
						<SessionCard.SessionIdFact />
						<SessionCard.LastEventFact />
						<SessionCard.StreamFact />
						<SessionCard.SeenFact />
						<SessionCard.CwdFact />
					</SessionCard.Facts>
				</SessionCard.Frame>
			</SessionCard.Provider>
		</TooltipProvider>
	);
}
