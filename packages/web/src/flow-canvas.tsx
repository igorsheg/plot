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
import { FleetSessionCard } from "./session-card.js";

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
	"plot-session": SessionNodeCard,
} satisfies NodeTypes;

function SessionNodeCard({ data }: NodeProps<SessionNode>) {
	return <FleetSessionCard session={data.session} live={data.live} />;
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
					color="var(--plot-canvas-grid)"
				/>
				<MiniMap pannable zoomable nodeStrokeWidth={2} />
				<Controls showInteractive={false} />
			</ReactFlow>
		</ReactFlowProvider>
	);
}
