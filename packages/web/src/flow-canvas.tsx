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
		<article className="session-node">
			<header className="session-node__header">
				<div>
					<strong>{session.workflowName}</strong>
					<span>{session.cwdName}</span>
				</div>
				<small>pid {session.pid}</small>
			</header>
			<dl className="session-node__body">
				<div>
					<dt>session</dt>
					<dd>{session.sessionId}</dd>
				</div>
				<div>
					<dt>last</dt>
					<dd>
						{live?.lastType ?? session.lastEventType ?? "registered"} #
						{live?.frontier ?? session.lastSequence}
					</dd>
				</div>
				<div>
					<dt>stream</dt>
					<dd>
						{live === undefined ? "connecting" : `${live.eventCount} event(s)`}
					</dd>
				</div>
				<div>
					<dt>seen</dt>
					<dd>{formatHeartbeat(session.heartbeatAt)}</dd>
				</div>
				<div>
					<dt>cwd</dt>
					<dd title={session.cwd}>{session.cwd}</dd>
				</div>
			</dl>
		</article>
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
