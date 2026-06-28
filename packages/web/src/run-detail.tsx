import { createContext, use } from "react";
import type { ReactNode } from "react";
import type { WebActivityEntry, WebDashboardProjection } from "./api.js";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import {
	Card,
	CardHeader,
	CardPanel,
	CardTitle,
} from "./components/ui/card.js";
import { Empty, EmptyDescription, EmptyHeader } from "./components/ui/empty.js";
import { Kbd } from "./components/ui/kbd.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { Separator } from "./components/ui/separator.js";
import { Skeleton } from "./components/ui/skeleton.js";
import type { PlotRun } from "./run.js";

export interface RunDetailState {
	readonly error?: string | undefined;
	readonly loading: boolean;
	readonly projection?: WebDashboardProjection | undefined;
	readonly run: PlotRun;
}

interface RunDetailContextValue {
	readonly state: RunDetailState;
	readonly actions: { readonly close: () => void };
	readonly meta: Record<string, never>;
}

const RunDetailContext = createContext<RunDetailContextValue | null>(null);

const useRunDetail = (): RunDetailContextValue => {
	const value = use(RunDetailContext);
	if (value === null) throw new Error("RunDetailContext missing");
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
	readonly state: RunDetailState;
}) {
	return (
		<RunDetailContext value={{ state, actions: { close: onClose }, meta: {} }}>
			{children}
		</RunDetailContext>
	);
}

function Frame({ children }: { readonly children: ReactNode }) {
	return <Card className="plot-detail-window">{children}</Card>;
}

function Header() {
	const {
		actions,
		state: { projection, run },
	} = useRunDetail();
	return (
		<CardHeader className="plot-detail-header">
			<div className="plot-detail-title-group">
				<CardTitle className="plot-detail-title">
					{run.workflowName ?? run.sessionId ?? run.id}
				</CardTitle>
				<p className="plot-detail-subtitle">{run.cwd}</p>
			</div>
			<div className="plot-detail-actions">
				<Badge variant="outline">{projection?.status ?? "loading"}</Badge>
				<span className="plot-detail-close-hint">
					<Kbd>Esc</Kbd>
				</span>
				<Button
					variant="outline"
					size="sm"
					type="button"
					onClick={actions.close}
				>
					Close
				</Button>
			</div>
		</CardHeader>
	);
}

function Body() {
	return (
		<CardPanel className="plot-detail-body-shell">
			<ScrollArea className="plot-detail-scroll" fill scrollFade>
				<div className="plot-detail-body">
					<Summary />
					<DetailError />
					<WorkList />
					<AttemptList />
					<ActivityList />
				</div>
			</ScrollArea>
		</CardPanel>
	);
}

function Summary() {
	const {
		state: { loading, projection, run },
	} = useRunDetail();
	const workCount = Object.keys(projection?.work ?? {}).length;
	const attemptCount = Object.keys(projection?.attempts ?? {}).length;
	return (
		<section className="plot-detail-summary">
			<Metric
				label="frontier"
				value={String(projection?.frontier ?? run.lastSequence ?? 0)}
			/>
			<Metric label="work" value={loading ? <LoadingValue /> : workCount} />
			<Metric
				label="attempts"
				value={loading ? <LoadingValue /> : attemptCount}
			/>
		</section>
	);
}

function LoadingValue() {
	return <Skeleton className="plot-detail-skeleton" />;
}

function DetailError() {
	const {
		state: { error },
	} = useRunDetail();
	if (!error) return null;
	return (
		<Alert variant="error">
			<AlertTitle>Projection failed</AlertTitle>
			<AlertDescription>{error}</AlertDescription>
		</Alert>
	);
}

function Metric(props: { readonly label: string; readonly value: ReactNode }) {
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
			<Separator />
			{children}
		</section>
	);
}

function EmptyState({ children }: { readonly children: ReactNode }) {
	return (
		<Empty className="plot-detail-empty-state">
			<EmptyHeader>
				<EmptyDescription>{children}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

function WorkList() {
	const {
		state: { projection },
	} = useRunDetail();
	const work = Object.values(projection?.work ?? {}).slice(0, 5);
	return (
		<Section title="Active work">
			{work.length === 0 ? <EmptyState>No active work.</EmptyState> : null}
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
	} = useRunDetail();
	const attempts = Object.values(projection?.attempts ?? {}).slice(0, 5);
	return (
		<Section title="Active attempts">
			{attempts.length === 0 ? (
				<EmptyState>No active attempts.</EmptyState>
			) : null}
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
	} = useRunDetail();
	const activity = latestActivity(projection?.activity);
	return (
		<Section title="Activity">
			{activity.length === 0 ? (
				<EmptyState>No recent activity.</EmptyState>
			) : null}
			{activity.map((item, index) => (
				<div className="plot-detail-row" key={index}>
					<span className="plot-detail-row-primary">{item.text}</span>
				</div>
			))}
		</Section>
	);
}

const RunDetail = {
	Provider,
	Frame,
	Header,
	Body,
};

export function RunDetailWindow(props: {
	readonly onClose: () => void;
	readonly state: RunDetailState;
}) {
	return (
		<RunDetail.Provider state={props.state} onClose={props.onClose}>
			<RunDetail.Frame>
				<RunDetail.Header />
				<RunDetail.Body />
			</RunDetail.Frame>
		</RunDetail.Provider>
	);
}
