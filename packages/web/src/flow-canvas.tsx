import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	applyNodeChanges,
	Background,
	BackgroundVariant,
	Controls,
	MarkerType,
	MiniMap,
	NodeResizer,
	NodeToolbar,
	Panel,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
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
import { Group, GroupSeparator } from "./components/ui/group.js";
import type { RunLiveMap, RunLiveState } from "./live-events.js";
import type { PlotRun } from "./run.js";
import { RunDetailWindow } from "./run-detail.js";
import { RunCardView } from "./run-card.js";

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
	readonly live: RunLiveMap;
	readonly onCloseDetail: (key: string) => void;
	readonly onOpenDetail: (key: string) => void;
	readonly openDetailKeys: readonly string[];
	readonly runs: readonly PlotRun[];
}

type RunNode = Node<
	{
		readonly live?: RunLiveState | undefined;
		readonly onFocus: () => void;
		readonly onOpen: () => void;
		readonly run: PlotRun;
	},
	"plot-run"
>;

type DetailNode = Node<
	{
		readonly detail: DetailEntry;
		readonly onClose: () => void;
		readonly onFocus: () => void;
		readonly onResizeEnd: (
			layout: Required<Pick<DetailLayout, "height" | "width">>,
		) => void;
		readonly run: PlotRun;
	},
	"run-detail"
>;

type PlotNode = DetailNode | RunNode;
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
const fitViewOptions = { padding: 0.2, maxZoom: 1 };
const proOptions = { hideAttribution: true };
const detailEdgeMarker = {
	type: MarkerType.ArrowClosed,
	color: "var(--plot-detail-edge)",
	width: 18,
	height: 18,
};

const nodeTypes = {
	"plot-run": RunNodeCard,
	"run-detail": DetailNodeCard,
} satisfies NodeTypes;

const readStoredLayout = (): Record<string, DetailLayout> => {
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

function RunNodeCard({ data, id, selected }: NodeProps<RunNode>) {
	return (
		<>
			<NodeToolbar
				className="plot-node-toolbar-shell"
				isVisible={selected}
				nodeId={id}
				position={Position.Top}
			>
				<Group className="plot-node-toolbar" aria-label="Run actions">
					<Button size="sm" variant="secondary" onClick={data.onOpen}>
						Open
					</Button>
					<GroupSeparator />
					<Button size="sm" variant="outline" onClick={data.onFocus}>
						Focus
					</Button>
				</Group>
			</NodeToolbar>
			<RunCardView run={data.run} live={data.live} />
		</>
	);
}

function DetailNodeCard({ data, id, selected }: NodeProps<DetailNode>) {
	return (
		<>
			<NodeResizer
				handleClassName="plot-resize-handle"
				isVisible={selected}
				lineClassName="plot-resize-line"
				minHeight={360}
				minWidth={420}
				nodeId={id}
				onResizeEnd={(_event, params) =>
					data.onResizeEnd({ height: params.height, width: params.width })
				}
			/>
			<NodeToolbar
				className="plot-node-toolbar-shell"
				isVisible={selected}
				nodeId={id}
				position={Position.Top}
			>
				<Group className="plot-node-toolbar" aria-label="Detail actions">
					<Button size="sm" variant="outline" onClick={data.onFocus}>
						Focus
					</Button>
					<GroupSeparator />
					<Button size="sm" variant="outline" onClick={data.onClose}>
						Close
					</Button>
				</Group>
			</NodeToolbar>
			<RunDetailWindow
				onClose={data.onClose}
				state={{
					error: data.detail.error,
					loading: data.detail.loading,
					projection: data.detail.projection,
					run: data.run,
				}}
			/>
		</>
	);
}

const runPosition = (index: number) => ({
	x: (index % 3) * cardGapX,
	y: Math.floor(index / 3) * cardGapY,
});

const detailNodeId = (key: string) => `detail:${key}`;
const detailKey = (id: string) => id.slice("detail:".length);

const detailPosition = (index: number, layout: DetailLayout | undefined) => {
	if (layout?.position !== undefined) return layout.position;
	const origin = runPosition(index);
	return { x: origin.x + detailOffsetX, y: origin.y + detailOffsetY };
};

const detailSize = (layout: DetailLayout | undefined) => ({
	height: layout?.height ?? detailHeight,
	width: layout?.width ?? detailWidth,
});

const detailEdges = (keys: readonly string[]): PlotEdge[] =>
	keys.map((key) => ({
		animated: true,
		className: "plot-detail-edge",
		data: {},
		id: `edge:${key}`,
		markerEnd: detailEdgeMarker,
		source: key,
		target: detailNodeId(key),
		type: "smoothstep",
	}));

const minimapColor = (node: PlotNode) =>
	node.type === "run-detail" ? "var(--info)" : "var(--primary)";

function PlotCanvasSurface(props: PlotCanvasProps) {
	const flow = useReactFlow<PlotNode, PlotEdge>();
	const flowRef = useRef(flow);
	const layoutRef = useRef(readStoredLayout());
	const [nodes, setNodes] = useState<PlotNode[]>([]);
	const [selectedNodeId, setSelectedNodeId] = useState<string>();
	const lastOpenSignature = useRef("");
	const propsRef = useRef(props);

	useEffect(() => {
		flowRef.current = flow;
	}, [flow]);

	useEffect(() => {
		propsRef.current = props;
	}, [props]);

	const focusNodes = useCallback((ids: readonly string[]) => {
		requestAnimationFrame(() => {
			void flowRef.current.fitView({
				duration: 240,
				maxZoom: 1.1,
				nodes: ids.map((id) => ({ id })),
				padding: 0.24,
			});
		});
	}, []);

	const persistDetailLayout = useCallback(
		(key: string, patch: DetailLayout) => {
			layoutRef.current = {
				...layoutRef.current,
				[key]: { ...layoutRef.current[key], ...patch },
			};
			writeStoredLayout(layoutRef.current);
		},
		[],
	);

	const reconcileNodes = useCallback(() => {
		setNodes((previous) => {
			const previousById = new Map(previous.map((node) => [node.id, node]));
			const next: PlotNode[] = [];

			for (const [index, run] of propsRef.current.runs.entries()) {
				const existing = previousById.get(run.id) as RunNode | undefined;
				next.push({
					...existing,
					draggable: false,
					id: run.id,
					position: runPosition(index),
					sourcePosition: Position.Right,
					targetPosition: Position.Left,
					type: "plot-run",
					data: {
						live: propsRef.current.live[run.id],
						onFocus: () => focusNodes([run.id]),
						onOpen: () => propsRef.current.onOpenDetail(run.id),
						run,
					},
				});
			}

			for (const key of propsRef.current.openDetailKeys) {
				const index = propsRef.current.runs.findIndex((run) => run.id === key);
				const run = propsRef.current.runs[index];
				if (run === undefined || index < 0) continue;
				const id = detailNodeId(key);
				const existing = previousById.get(id) as DetailNode | undefined;
				const saved = layoutRef.current[key];
				const savedSize = detailSize(saved);
				const width = existing?.width ?? savedSize.width;
				const height = existing?.height ?? savedSize.height;
				next.push({
					...existing,
					className: "plot-detail-node",
					draggable: true,
					height,
					id,
					position: existing?.position ?? detailPosition(index, saved),
					sourcePosition: Position.Right,
					style: { height, width },
					targetPosition: Position.Left,
					type: "run-detail",
					width,
					data: {
						detail: propsRef.current.details[key] ?? { loading: true },
						onClose: () => propsRef.current.onCloseDetail(key),
						onFocus: () => focusNodes([id]),
						onResizeEnd: (layout) => persistDetailLayout(key, layout),
						run,
					},
				});
			}

			return next;
		});
	}, [focusNodes, persistDetailLayout]);

	useEffect(() => {
		reconcileNodes();
	}, [
		props.details,
		props.live,
		props.openDetailKeys,
		props.runs,
		reconcileNodes,
	]);

	const edges = useMemo<PlotEdge[]>(
		() => detailEdges(props.openDetailKeys),
		[props.openDetailKeys],
	);

	const onNodesChange = useCallback<OnNodesChange<PlotNode>>((changes) => {
		setNodes((current) => applyNodeChanges(changes, current) as PlotNode[]);
	}, []);

	useEffect(() => {
		const previous = lastOpenSignature.current.split("\0");
		const signature = props.openDetailKeys.join("\0");
		const opened = props.openDetailKeys.find((key) => !previous.includes(key));
		lastOpenSignature.current = signature;
		if (opened === undefined) return;
		focusNodes([opened, detailNodeId(opened)]);
	}, [focusNodes, props.openDetailKeys]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.key !== "Escape" ||
				selectedNodeId === undefined ||
				!selectedNodeId.startsWith("detail:")
			)
				return;
			propsRef.current.onCloseDetail(detailKey(selectedNodeId));
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [selectedNodeId]);

	const closeAllDetails = () => {
		for (const key of props.openDetailKeys) props.onCloseDetail(key);
	};

	const focusRunRegistry = () => {
		focusNodes(props.runs.map((session) => session.id));
	};

	return (
		<ReactFlow<PlotNode, PlotEdge>
			edges={edges}
			elementsSelectable
			fitView
			fitViewOptions={fitViewOptions}
			maxZoom={1.5}
			minZoom={0.2}
			nodeExtent={canvasExtent}
			nodeTypes={nodeTypes}
			nodes={nodes}
			nodesConnectable={false}
			nodesDraggable
			onNodeClick={(_event, node) => {
				setSelectedNodeId(node.id);
				if (node.type === "plot-run") props.onOpenDetail(node.id);
			}}
			onNodeDoubleClick={(_event, node) => {
				if (node.type === "plot-run") props.onOpenDetail(node.id);
				focusNodes(
					node.type === "plot-run"
						? [node.id, detailNodeId(node.id)]
						: [node.id],
				);
			}}
			onNodeDragStop={(_event, node) => {
				setSelectedNodeId(node.id);
				if (node.type === "run-detail") {
					persistDetailLayout(detailKey(node.id), { position: node.position });
				}
			}}
			onNodesChange={onNodesChange}
			onPaneClick={() => setSelectedNodeId(undefined)}
			onSelectionChange={(selection) =>
				setSelectedNodeId(selection.nodes[0]?.id)
			}
			onlyRenderVisibleElements
			panOnScroll
			proOptions={proOptions}
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
				<Group aria-label="Canvas actions">
					<Button size="sm" variant="secondary" onClick={focusRunRegistry}>
						Fit runs
					</Button>
					<GroupSeparator />
					<Button size="sm" variant="outline" onClick={closeAllDetails}>
						Close details
					</Button>
				</Group>
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
