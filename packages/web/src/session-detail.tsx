import { createContext, use } from "react";
import type { ReactNode } from "react";
import type { WebActivityEntry, WebDashboardProjection } from "./api.js";
import { Badge } from "./components/ui/badge.js";
import {
	Card,
	CardHeader,
	CardPanel,
	CardTitle,
} from "./components/ui/card.js";
import type { PlotSessionRegistration } from "./registration.js";

export interface SessionDetailState {
	readonly error?: string | undefined;
	readonly loading: boolean;
	readonly projection?: WebDashboardProjection | undefined;
	readonly session: PlotSessionRegistration;
}

interface SessionDetailContextValue {
	readonly state: SessionDetailState;
	readonly actions: { readonly close: () => void };
	readonly meta: Record<string, never>;
}

const SessionDetailContext = createContext<SessionDetailContextValue | null>(
	null,
);

const useSessionDetail = (): SessionDetailContextValue => {
	const value = use(SessionDetailContext);
	if (value === null) throw new Error("SessionDetailContext missing");
	return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const workTitle = (value: unknown): string => {
	if (!isRecord(value)) return "work";
	const display = isRecord(value["display"]) ? value["display"] : {};
	return String(
		display["title"] ?? value["title"] ?? value["workKey"] ?? "work",
	);
};

const attemptLabel = (value: unknown): string => {
	if (!isRecord(value)) return "attempt";
	return String(
		value["activity"] ?? value["lastDisplay"] ?? value["runId"] ?? "attempt",
	);
};

const latestActivity = (
	activity: readonly WebActivityEntry[] | undefined,
): readonly WebActivityEntry[] => (activity ?? []).slice(0, 6);

function Provider({
	children,
	onClose,
	state,
}: {
	readonly children: ReactNode;
	readonly onClose: () => void;
	readonly state: SessionDetailState;
}) {
	return (
		<SessionDetailContext
			value={{ state, actions: { close: onClose }, meta: {} }}
		>
			{children}
		</SessionDetailContext>
	);
}

function Frame({ children }: { readonly children: ReactNode }) {
	return <Card className="plot-detail-window">{children}</Card>;
}

function Header() {
	const {
		actions,
		state: { projection, session },
	} = useSessionDetail();
	return (
		<CardHeader className="plot-detail-header">
			<div className="plot-detail-title-group">
				<CardTitle className="plot-detail-title">
					{session.workflowName}
				</CardTitle>
				<p className="plot-detail-subtitle">{session.cwd}</p>
			</div>
			<div className="plot-detail-actions">
				<Badge variant="outline">{projection?.status ?? "loading"}</Badge>
				<button
					className="plot-detail-close"
					type="button"
					onClick={actions.close}
				>
					Close
				</button>
			</div>
		</CardHeader>
	);
}

function Body() {
	return (
		<CardPanel className="plot-detail-body">
			<Summary />
			<WorkList />
			<AttemptList />
			<ActivityList />
		</CardPanel>
	);
}

function Summary() {
	const {
		state: { error, loading, projection, session },
	} = useSessionDetail();
	const workCount = Object.keys(projection?.work ?? {}).length;
	const attemptCount = Object.keys(projection?.attempts ?? {}).length;
	return (
		<section className="plot-detail-summary">
			<Metric
				label="frontier"
				value={String(projection?.frontier ?? session.lastSequence)}
			/>
			<Metric label="work" value={loading ? "…" : String(workCount)} />
			<Metric label="attempts" value={loading ? "…" : String(attemptCount)} />
			{error ? <Metric label="error" value={error} /> : null}
		</section>
	);
}

function Metric(props: { readonly label: string; readonly value: string }) {
	return (
		<div className="plot-detail-metric">
			<div className="plot-detail-metric-label">{props.label}</div>
			<div className="plot-detail-metric-value">{props.value}</div>
		</div>
	);
}

function Section({
	children,
	title,
}: {
	readonly children: ReactNode;
	readonly title: string;
}) {
	return (
		<section className="plot-detail-section">
			<h3 className="plot-detail-section-title">{title}</h3>
			{children}
		</section>
	);
}

function Empty({ children }: { readonly children: ReactNode }) {
	return <p className="plot-detail-empty">{children}</p>;
}

function WorkList() {
	const {
		state: { projection },
	} = useSessionDetail();
	const work = Object.values(projection?.work ?? {}).slice(0, 5);
	return (
		<Section title="Active work">
			{work.length === 0 ? <Empty>No active work.</Empty> : null}
			{work.map((item, index) => (
				<div className="plot-detail-row" key={index}>
					<span className="plot-detail-row-primary">{workTitle(item)}</span>
				</div>
			))}
		</Section>
	);
}

function AttemptList() {
	const {
		state: { projection },
	} = useSessionDetail();
	const attempts = Object.values(projection?.attempts ?? {}).slice(0, 5);
	return (
		<Section title="Active attempts">
			{attempts.length === 0 ? <Empty>No active attempts.</Empty> : null}
			{attempts.map((item, index) => (
				<div className="plot-detail-row" key={index}>
					<span className="plot-detail-row-primary">{attemptLabel(item)}</span>
				</div>
			))}
		</Section>
	);
}

function ActivityList() {
	const {
		state: { projection },
	} = useSessionDetail();
	const activity = latestActivity(projection?.activity);
	return (
		<Section title="Activity">
			{activity.length === 0 ? <Empty>No recent activity.</Empty> : null}
			{activity.map((item, index) => (
				<div className="plot-detail-row" key={index}>
					<span className="plot-detail-row-primary">{item.text}</span>
				</div>
			))}
		</Section>
	);
}

const SessionDetail = {
	Provider,
	Frame,
	Header,
	Body,
};

export function SessionDetailWindow(props: {
	readonly onClose: () => void;
	readonly state: SessionDetailState;
}) {
	return (
		<SessionDetail.Provider state={props.state} onClose={props.onClose}>
			<SessionDetail.Frame>
				<SessionDetail.Header />
				<SessionDetail.Body />
			</SessionDetail.Frame>
		</SessionDetail.Provider>
	);
}
