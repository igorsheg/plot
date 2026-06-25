import { createContext, use } from "react";
import type { ReactNode } from "react";
import { Badge } from "./components/ui/badge.js";
import {
	Card,
	CardHeader,
	CardPanel,
	CardTitle,
} from "./components/ui/card.js";
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
	return (
		<Card className="w-[400px] overflow-hidden shadow-xl/10">{children}</Card>
	);
}

function Header({ children }: { readonly children: ReactNode }) {
	return (
		<CardHeader className="grid-cols-[1fr_auto] border-b bg-muted/50 p-4">
			{children}
		</CardHeader>
	);
}

function Identity() {
	const {
		state: { session },
	} = useSessionCard();
	return (
		<div className="min-w-0">
			<CardTitle className="truncate text-[15px]">
				{session.workflowName}
			</CardTitle>
			<p className="truncate text-muted-foreground text-sm">
				{session.cwdName}
			</p>
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
	return <CardPanel className="grid gap-3 p-4 text-sm">{children}</CardPanel>;
}

function Fact(props: {
	readonly label: string;
	readonly title?: string | undefined;
	readonly value: string;
}) {
	return (
		<div className="min-w-0">
			<div className="font-semibold text-[11px] text-muted-foreground uppercase tracking-widest">
				{props.label}
			</div>
			<div className="truncate text-foreground" title={props.title}>
				{props.value}
			</div>
		</div>
	);
}

function SessionIdFact() {
	const {
		state: { session },
	} = useSessionCard();
	return <Fact label="session" value={session.sessionId} />;
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
	);
}
