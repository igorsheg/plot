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
import type { WebDashboardProjection } from "./api.js";
import type { SessionLiveMap, SessionLiveState } from "./live-events.js";
import type { PlotSessionRegistration } from "./registration.js";
import { SessionDetailWindow } from "./session-detail.js";
import { FleetSessionCard } from "./session-card.js";

interface DetailEntry {
	readonly error?: string | undefined;
	readonly loading: boolean;
	readonly projection?: WebDashboardProjection | undefined;
}

export interface PlotCanvasProps {
	readonly details: Readonly<Record<string, DetailEntry>>;
	readonly live: SessionLiveMap;
	readonly onCloseDetail: (key: string) => void;
	readonly onOpenDetail: (key: string) => void;
	readonly openDetailKeys: readonly string[];
	readonly sessions: readonly PlotSessionRegistration[];
}

type SessionNode = Node<
	{
		readonly live?: SessionLiveState | undefined;
		readonly session: PlotSessionRegistration;
	},
	"plot-session"
>;

type DetailNode = Node<
	{
		readonly detail: DetailEntry;
		readonly onClose: () => void;
		readonly session: PlotSessionRegistration;
	},
	"session-detail"
>;

type PlotNode = DetailNode | SessionNode;

const cardGapX = 460;
const cardGapY = 260;
const detailOffsetX = 460;
const detailOffsetY = 24;

const nodeTypes = {
	"plot-session": SessionNodeCard,
	"session-detail": DetailNodeCard,
} satisfies NodeTypes;

function SessionNodeCard({ data }: NodeProps<SessionNode>) {
	return <FleetSessionCard session={data.session} live={data.live} />;
}

function DetailNodeCard({ data }: NodeProps<DetailNode>) {
	return (
		<SessionDetailWindow
			onClose={data.onClose}
			state={{
				error: data.detail.error,
				loading: data.detail.loading,
				projection: data.detail.projection,
				session: data.session,
			}}
		/>
	);
}

const sessionPosition = (index: number) => ({
	x: (index % 3) * cardGapX,
	y: Math.floor(index / 3) * cardGapY,
});

const sessionNodes = (
	sessions: readonly PlotSessionRegistration[],
	live: SessionLiveMap,
): SessionNode[] =>
	sessions.map((session, index) => ({
		id: session.key,
		type: "plot-session",
		position: sessionPosition(index),
		data: { session, live: live[session.key] },
	}));

const detailNodes = (input: {
	readonly details: Readonly<Record<string, DetailEntry>>;
	readonly onCloseDetail: (key: string) => void;
	readonly openDetailKeys: readonly string[];
	readonly sessions: readonly PlotSessionRegistration[];
}): DetailNode[] =>
	input.openDetailKeys.flatMap((key) => {
		const index = input.sessions.findIndex((session) => session.key === key);
		const session = input.sessions[index];
		if (session === undefined || index < 0) return [];
		const origin = sessionPosition(index);
		return [
			{
				id: `detail:${key}`,
				type: "session-detail",
				position: { x: origin.x + detailOffsetX, y: origin.y + detailOffsetY },
				data: {
					detail: input.details[key] ?? { loading: true },
					onClose: () => input.onCloseDetail(key),
					session,
				},
			},
		];
	});

export function PlotCanvas(props: PlotCanvasProps) {
	const nodes = useMemo<PlotNode[]>(
		() => [
			...sessionNodes(props.sessions, props.live),
			...detailNodes({
				details: props.details,
				onCloseDetail: props.onCloseDetail,
				openDetailKeys: props.openDetailKeys,
				sessions: props.sessions,
			}),
		],
		[
			props.details,
			props.live,
			props.onCloseDetail,
			props.openDetailKeys,
			props.sessions,
		],
	);

	return (
		<ReactFlowProvider>
			<ReactFlow<PlotNode>
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
				onNodeClick={(_event, node) => {
					if (node.type === "plot-session") props.onOpenDetail(node.id);
				}}
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
