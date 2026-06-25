import { useMemo } from "react";
import {
	Background,
	BackgroundVariant,
	Controls,
	MiniMap,
	ReactFlow,
	ReactFlowProvider,
	type Node,
	type NodeProps,
	type NodeTypes,
} from "@xyflow/react";
// oxlint-disable-next-line import/no-unassigned-import
import "@xyflow/react/dist/style.css";
import { Badge } from "./components/ui/badge.js";
import {
	Card,
	CardHeader,
	CardPanel,
	CardTitle,
} from "./components/ui/card.js";
import type { SessionLiveMap, SessionLiveState } from "./live-events.js";
import type { PlotSessionRegistration } from "./registration.js";

export interface PlotCanvasProps {
	readonly sessions: readonly PlotSessionRegistration[];
	readonly live: SessionLiveMap;
}

type SessionNode = Node<
	{
		readonly live?: SessionLiveState | undefined;
		readonly session: PlotSessionRegistration;
	},
	"plot-session"
>;

const nodeTypes = {
	"plot-session": SessionCard,
} satisfies NodeTypes;

const formatHeartbeat = (value: string) => {
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) return value;
	const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
	return seconds < 2 ? "now" : `${seconds}s ago`;
};

function SessionCard({ data }: NodeProps<SessionNode>) {
	const session = data.session;
	const live = data.live;
	return (
		<Card className="w-[400px] overflow-hidden shadow-xl/10">
			<CardHeader className="grid-cols-[1fr_auto] border-b bg-muted/50 p-4">
				<div className="min-w-0">
					<CardTitle className="truncate text-[15px]">
						{session.workflowName}
					</CardTitle>
					<p className="truncate text-muted-foreground text-sm">
						{session.cwdName}
					</p>
				</div>
				<Badge variant="outline">pid {session.pid}</Badge>
			</CardHeader>
			<CardPanel className="grid gap-3 p-4 text-sm">
				<SessionFact label="session" value={session.sessionId} />
				<SessionFact
					label="last"
					value={`${live?.lastType ?? session.lastEventType ?? "registered"} #${live?.frontier ?? session.lastSequence}`}
				/>
				<SessionFact
					label="stream"
					value={
						live === undefined ? "connecting" : `${live.eventCount} event(s)`
					}
				/>
				<SessionFact
					label="seen"
					value={formatHeartbeat(session.heartbeatAt)}
				/>
				<SessionFact label="cwd" value={session.cwd} title={session.cwd} />
			</CardPanel>
		</Card>
	);
}

function SessionFact(props: {
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

const sessionNodes = (
	sessions: readonly PlotSessionRegistration[],
	live: SessionLiveMap,
): SessionNode[] =>
	sessions.map((session, index) => ({
		id: session.key,
		type: "plot-session",
		position: {
			x: (index % 3) * 460,
			y: Math.floor(index / 3) * 260,
		},
		data: { session, live: live[session.key] },
	}));

export function PlotCanvas({ sessions, live }: PlotCanvasProps) {
	const nodes = useMemo(() => sessionNodes(sessions, live), [sessions, live]);

	return (
		<ReactFlowProvider>
			<ReactFlow<SessionNode>
				nodes={nodes}
				edges={[]}
				nodeTypes={nodeTypes}
				fitView
				fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
				minZoom={0.2}
				maxZoom={1.5}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				panOnScroll
				selectionOnDrag={false}
				proOptions={{ hideAttribution: true }}
			>
				<Background
					variant={BackgroundVariant.Dots}
					gap={24}
					size={1}
					color="rgba(99, 114, 142, 0.35)"
				/>
				<MiniMap pannable zoomable nodeStrokeWidth={2} />
				<Controls showInteractive={false} />
			</ReactFlow>
		</ReactFlowProvider>
	);
}
