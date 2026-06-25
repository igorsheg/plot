import { useCallback, useEffect, useMemo, useState } from "react";
import {
	applyNodeChanges,
	Background,
	BackgroundVariant,
	Controls,
	MiniMap,
	NodeResizer,
	NodeToolbar,
	Panel,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	useUpdateNodeInternals,
	type Edge,
	type Node,
	type NodeProps,
	type NodeTypes,
	type OnNodesChange,
} from "@xyflow/react";
// oxlint-disable-next-line import/no-unassigned-import
import "@xyflow/react/dist/style.css";
import type { WebDashboardProjection } from "./api.js";
import { Button } from "./components/ui/button.js";
import type { SessionLiveMap, SessionLiveState } from "./live-events.js";
import type { PlotSessionRegistration } from "./registration.js";
import { SessionDetailWindow } from "./session-detail.js";
import { FleetSessionCard } from "./session-card.js";

interface DetailEntry {
	readonly error?: string | undefined;
	readonly loading: boolean;
	readonly projection?: WebDashboardProjection | undefined;
}

interface DetailLayout {
	readonly height?: number | undefined;
	readonly position?: { readonly x: number; readonly y: number } | undefined;
	readonly width?: number | undefined;
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
		readonly onFocus: () => void;
		readonly onOpen: () => void;
		readonly session: PlotSessionRegistration;
	},
	"plot-session"
>;

type DetailNode = Node<
	{
		readonly detail: DetailEntry;
		readonly onClose: () => void;
		readonly onFocus: () => void;
		readonly session: PlotSessionRegistration;
	},
	"session-detail"
>;

type PlotNode = DetailNode | SessionNode;
type PlotEdge = Edge<Record<string, never>, "smoothstep">;

const cardGapX = 460;
const cardGapY = 260;
const detailHeight = 560;
const detailOffsetX = 460;
const detailOffsetY = 24;
const detailWidth = 560;
const layoutStorageKey = "plot:web:detail-layout:v1";
const canvasExtent: [[number, number], [number, number]] = [
	[-8_000, -8_000],
	[12_000, 12_000],
];

const nodeTypes = {
	"plot-session": SessionNodeCard,
	"session-detail": DetailNodeCard,
} satisfies NodeTypes;

const readStoredLayout = (): Readonly<Record<string, DetailLayout>> => {
	try {
		const value = localStorage.getItem(layoutStorageKey);
		return value === null
			? {}
			: (JSON.parse(value) as Record<string, DetailLayout>);
	} catch {
		return {};
	}
};

const writeStoredLayout = (layout: Readonly<Record<string, DetailLayout>>) => {
	try {
		localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
	} catch {
		// ponytail: layout persistence is a convenience; canvas must keep working.
	}
};

function SessionNodeCard({ data, id, selected }: NodeProps<SessionNode>) {
	return (
		<>
			<NodeToolbar
				className="plot-node-toolbar"
				isVisible={selected}
				nodeId={id}
				position={Position.Top}
			>
				<Button size="sm" variant="secondary" onClick={data.onOpen}>
					Open
				</Button>
				<Button size="sm" variant="outline" onClick={data.onFocus}>
					Focus
				</Button>
			</NodeToolbar>
			<FleetSessionCard session={data.session} live={data.live} />
		</>
	);
}

function DetailNodeCard({ data, id, selected }: NodeProps<DetailNode>) {
	const updateNodeInternals = useUpdateNodeInternals();
	useEffect(() => {
		updateNodeInternals(id);
	}, [data.detail.projection, id, updateNodeInternals]);
	return (
		<>
			<NodeResizer
				handleClassName="plot-resize-handle"
				isVisible={selected}
				lineClassName="plot-resize-line"
				minHeight={360}
				minWidth={420}
				nodeId={id}
			/>
			<NodeToolbar
				className="plot-node-toolbar"
				isVisible={selected}
				nodeId={id}
				position={Position.Top}
			>
				<Button size="sm" variant="outline" onClick={data.onFocus}>
					Focus
				</Button>
				<Button size="sm" variant="outline" onClick={data.onClose}>
					Close
				</Button>
			</NodeToolbar>
			<SessionDetailWindow
				onClose={data.onClose}
				state={{
					error: data.detail.error,
					loading: data.detail.loading,
					projection: data.detail.projection,
					session: data.session,
				}}
			/>
		</>
	);
}

const sessionPosition = (index: number) => ({
	x: (index % 3) * cardGapX,
	y: Math.floor(index / 3) * cardGapY,
});

const detailNodeId = (key: string) => `detail:${key}`;
const detailKey = (id: string) => id.slice("detail:".length);

const detailPosition = (index: number, layout: DetailLayout | undefined) => {
	if (layout?.position !== undefined) return layout.position;
	const origin = sessionPosition(index);
	return { x: origin.x + detailOffsetX, y: origin.y + detailOffsetY };
};

const sessionNodes = (input: {
	readonly live: SessionLiveMap;
	readonly onFocusNode: (ids: readonly string[]) => void;
	readonly onOpenDetail: (key: string) => void;
	readonly selectedNodeId?: string | undefined;
	readonly sessions: readonly PlotSessionRegistration[];
}): SessionNode[] =>
	input.sessions.map((session, index) => ({
		draggable: false,
		id: session.key,
		position: sessionPosition(index),
		selected: input.selectedNodeId === session.key,
		type: "plot-session",
		data: {
			live: input.live[session.key],
			onFocus: () => input.onFocusNode([session.key]),
			onOpen: () => input.onOpenDetail(session.key),
			session,
		},
	}));

const detailNodes = (input: {
	readonly details: Readonly<Record<string, DetailEntry>>;
	readonly layout: Readonly<Record<string, DetailLayout>>;
	readonly onCloseDetail: (key: string) => void;
	readonly onFocusNode: (ids: readonly string[]) => void;
	readonly openDetailKeys: readonly string[];
	readonly selectedNodeId?: string | undefined;
	readonly sessions: readonly PlotSessionRegistration[];
}): DetailNode[] =>
	input.openDetailKeys.flatMap((key) => {
		const index = input.sessions.findIndex((session) => session.key === key);
		const session = input.sessions[index];
		if (session === undefined || index < 0) return [];
		const id = detailNodeId(key);
		const layout = input.layout[key];
		return [
			{
				className: "plot-detail-node",
				draggable: true,
				id,
				position: detailPosition(index, layout),
				selected: input.selectedNodeId === id,
				style: {
					height: layout?.height ?? detailHeight,
					width: layout?.width ?? detailWidth,
				},
				type: "session-detail",
				data: {
					detail: input.details[key] ?? { loading: true },
					onClose: () => input.onCloseDetail(key),
					onFocus: () => input.onFocusNode([id]),
					session,
				},
			},
		];
	});

const detailEdges = (keys: readonly string[]): PlotEdge[] =>
	keys.map((key) => ({
		animated: true,
		data: {},
		id: `edge:${key}`,
		source: key,
		target: detailNodeId(key),
		type: "smoothstep",
	}));

const minimapColor = (node: PlotNode) =>
	node.type === "session-detail" ? "var(--info)" : "var(--primary)";

function PlotCanvasSurface(props: PlotCanvasProps) {
	const flow = useReactFlow<PlotNode, PlotEdge>();
	const [detailLayout, setDetailLayout] = useState(readStoredLayout);
	const [selectedNodeId, setSelectedNodeId] = useState<string>();
	const [lastOpenSignature, setLastOpenSignature] = useState("");

	const focusNodes = useCallback(
		(ids: readonly string[]) => {
			void flow.fitView({
				duration: 240,
				maxZoom: 1.1,
				nodes: ids.map((id) => ({ id })),
				padding: 0.24,
			});
		},
		[flow],
	);

	const closeAllDetails = () => {
		for (const key of props.openDetailKeys) props.onCloseDetail(key);
	};

	const focusFleet = () => {
		focusNodes(props.sessions.map((session) => session.key));
	};

	const nodes = useMemo<PlotNode[]>(
		() => [
			...sessionNodes({
				live: props.live,
				onFocusNode: focusNodes,
				onOpenDetail: props.onOpenDetail,
				selectedNodeId,
				sessions: props.sessions,
			}),
			...detailNodes({
				details: props.details,
				layout: detailLayout,
				onCloseDetail: props.onCloseDetail,
				onFocusNode: focusNodes,
				openDetailKeys: props.openDetailKeys,
				selectedNodeId,
				sessions: props.sessions,
			}),
		],
		[
			detailLayout,
			focusNodes,
			props.details,
			props.live,
			props.onCloseDetail,
			props.onOpenDetail,
			props.openDetailKeys,
			props.sessions,
			selectedNodeId,
		],
	);

	const edges = useMemo<PlotEdge[]>(
		() => detailEdges(props.openDetailKeys),
		[props.openDetailKeys],
	);

	const onNodesChange = useCallback<OnNodesChange<PlotNode>>(
		(changes) => {
			const updated = applyNodeChanges(changes, nodes) as PlotNode[];
			setDetailLayout((previous) => {
				let next = previous;
				for (const node of updated) {
					if (node.type !== "session-detail") continue;
					const key = detailKey(node.id);
					const width =
						typeof node.style?.width === "number"
							? node.style.width
							: previous[key]?.width;
					const height =
						typeof node.style?.height === "number"
							? node.style.height
							: previous[key]?.height;
					next = {
						...next,
						[key]: { height, position: node.position, width },
					};
				}
				for (const change of changes) {
					if (
						change.type !== "dimensions" ||
						!change.id.startsWith("detail:") ||
						change.dimensions === undefined
					)
						continue;
					const key = detailKey(change.id);
					next = {
						...next,
						[key]: {
							...next[key],
							height: change.dimensions.height,
							width: change.dimensions.width,
						},
					};
				}
				return next;
			});
		},
		[nodes],
	);

	useEffect(() => {
		writeStoredLayout(detailLayout);
	}, [detailLayout]);

	useEffect(() => {
		const signature = props.openDetailKeys.join("\0");
		const opened = props.openDetailKeys.find(
			(key) => !lastOpenSignature.split("\0").includes(key),
		);
		setLastOpenSignature(signature);
		if (opened === undefined) return;
		focusNodes([opened, detailNodeId(opened)]);
	}, [focusNodes, lastOpenSignature, props.openDetailKeys]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.key !== "Escape" ||
				selectedNodeId === undefined ||
				!selectedNodeId.startsWith("detail:")
			)
				return;
			props.onCloseDetail(detailKey(selectedNodeId));
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [props, selectedNodeId]);

	return (
		<ReactFlow<PlotNode, PlotEdge>
			edges={edges}
			elementsSelectable
			fitView
			fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
			maxZoom={1.5}
			minZoom={0.2}
			nodeExtent={canvasExtent}
			nodeTypes={nodeTypes}
			nodes={nodes}
			nodesConnectable={false}
			nodesDraggable
			onNodeClick={(_event, node) => {
				setSelectedNodeId(node.id);
				if (node.type === "plot-session") props.onOpenDetail(node.id);
			}}
			onNodeDoubleClick={(_event, node) => {
				if (node.type === "plot-session") props.onOpenDetail(node.id);
				focusNodes(
					node.type === "plot-session"
						? [node.id, detailNodeId(node.id)]
						: [node.id],
				);
			}}
			onNodesChange={onNodesChange}
			onSelectionChange={(selection) =>
				setSelectedNodeId(selection.nodes[0]?.id)
			}
			onPaneClick={() => setSelectedNodeId(undefined)}
			onError={(_id, message) => {
				void message;
			}}
			onNodeDragStop={(_event, node) => {
				if (node.type === "session-detail") setSelectedNodeId(node.id);
			}}
			onlyRenderVisibleElements
			panOnScroll
			proOptions={{ hideAttribution: true }}
			selectionOnDrag={false}
			translateExtent={canvasExtent}
		>
			<Background
				color="var(--plot-canvas-grid)"
				gap={24}
				size={1}
				variant={BackgroundVariant.Dots}
			/>
			<Panel className="plot-canvas-panel" position="top-right">
				<Button size="sm" variant="secondary" onClick={focusFleet}>
					Fit fleet
				</Button>
				<Button size="sm" variant="outline" onClick={closeAllDetails}>
					Close details
				</Button>
			</Panel>
			<MiniMap nodeColor={minimapColor} pannable zoomable nodeStrokeWidth={2} />
			<Controls showInteractive={false} />
		</ReactFlow>
	);
}

export function PlotCanvas(props: PlotCanvasProps) {
	return (
		<ReactFlowProvider>
			<PlotCanvasSurface {...props} />
		</ReactFlowProvider>
	);
}
