/**
 * Session dock — a vertical, left-docked rail with subtle macOS-style cursor
 * magnification. Only live sessions get tiles; a ghost "+N" tile expands the
 * rail to reveal stopped (past) sessions as a read-only view. The physics are
 * rotated 90° from the reference dock: we track the cursor's Y over the rail,
 * measure each tile's center offset within the rail, and drive scale + nudge
 * springs off that signed distance (pure math in `magnify`). `useReducedMotion`
 * disables magnification entirely; tooltips remain.
 */

import { useStore } from "@nanostores/react";
import { atom } from "nanostores";
import {
	motion,
	type MotionStyle,
	type MotionValue,
	useMotionValue,
	useReducedMotion,
	useSpring,
	useTransform,
} from "motion/react";
import {
	type CSSProperties,
	type FocusEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { $nowMs } from "../../app/time-store.js";
import {
	$pastRuns,
	$runs,
	$selectedRun,
	selectRun,
} from "../../app/runs-store.js";
import { formatRelative } from "../../lib/relative-time.js";
import { Text } from "../ui/text.js";
import { Tooltip, TooltipProvider } from "../ui/tooltip.js";
import {
	SessionDockProvider,
	useSessionDock,
	type SessionDockContextValue,
} from "./context.js";
import Avatar from "boring-avatars";
import {
	AVATAR_COLORS,
	buildLiveTiles,
	buildPastTiles,
	dockOrder,
	dockShortcutId,
	GHOST_TILE_KEY,
	magnify,
	nextDockKey,
	SPRING,
	type DockTile,
} from "./view-model.js";
const TILE_PX = 34;
const PANEL_BULGE = 14;

const navStyle: CSSProperties = { position: "relative", padding: 6 };

const columnStyle: CSSProperties = {
	alignItems: "center",
	display: "flex",
	flexDirection: "column",
	gap: 8,
	position: "relative",
	zIndex: 1,
};

const panelStyle: MotionStyle = {
	background: "color-mix(in oklch, var(--color-kumo-tint) 55%, transparent)",
	borderRadius: 16,
	left: 0,
	position: "absolute",
	right: 0,
	zIndex: 0,
};

const tileBaseStyle: MotionStyle = {
	background: "var(--color-kumo-tint)",
	border: 0,
	borderRadius: 9999,
	cursor: "pointer",
	display: "grid",
	flexShrink: 0,
	height: TILE_PX,
	padding: 0,
	placeItems: "center",
	position: "relative",
	transformOrigin: "left center",
	width: TILE_PX,
};

const ghostTileStyle: MotionStyle = {
	background: "transparent",
	border: 0,
	borderRadius: 9999,
	boxShadow: "inset 0 0 0 1.5px var(--color-kumo-line)",
	cursor: "pointer",
	display: "grid",
	flexShrink: 0,
	height: TILE_PX,
	padding: 0,
	placeItems: "center",
	position: "relative",
	transformOrigin: "left center",
	width: TILE_PX,
};

/** Marble art fills the circle; a line-height:0 wrapper kills svg baseline gap. */
const avatarWrapStyle: CSSProperties = { display: "grid", lineHeight: 0 };

const pastAvatarWrapStyle: CSSProperties = {
	...avatarWrapStyle,
	filter: "grayscale(1)",
	opacity: 0.75,
};

const dividerStyle: MotionStyle = {
	background: "var(--color-kumo-line)",
	flexShrink: 0,
	height: 1,
	transformOrigin: "left center",
	width: 20,
};

const selectedDotStyle: CSSProperties = {
	background: "var(--text-color-kumo-default)",
	borderRadius: 9999,
	height: 4,
	left: -6,
	position: "absolute",
	top: "50%",
	transform: "translateY(-50%)",
	width: 4,
};

const erroredDotStyle: CSSProperties = {
	background: "var(--color-kumo-danger)",
	borderRadius: 9999,
	boxShadow: "0 0 0 2px var(--color-kumo-canvas)",
	height: 7,
	position: "absolute",
	right: -3,
	top: -3,
	width: 7,
};

/** Springs on `scale`/`y` only, measured off the element's live center offset. */
function useMagnify<T extends HTMLElement>(
	mouseY: MotionValue<number>,
	layoutKey: string,
	reduced: boolean,
) {
	const ref = useRef<T | null>(null);
	const center = useMotionValue(0);
	const distance = useTransform(() => mouseY.get() - center.get());
	const scale = useTransform(distance, (d) => magnify(d).scale);
	const nudge = useTransform(distance, (d) => magnify(d).nudge);
	const scaleSpring = useSpring(scale, SPRING);
	const ySpring = useSpring(nudge, SPRING);
	useLayoutEffect(() => {
		const measure = () => {
			const el = ref.current;
			if (el !== null) center.set(el.offsetTop + el.offsetHeight / 2);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [center, layoutKey]);
	const transform: MotionStyle = reduced
		? {}
		: { y: ySpring, scale: scaleSpring };
	return { ref, transform };
}

/** The divider rides the magnification wave like any dock item (as on macOS). */
function DockDivider({
	mouseY,
	layoutKey,
	reduced,
}: {
	readonly mouseY: MotionValue<number>;
	readonly layoutKey: string;
	readonly reduced: boolean;
}) {
	const { ref, transform } = useMagnify<HTMLSpanElement>(
		mouseY,
		layoutKey,
		reduced,
	);
	return (
		<motion.span
			aria-hidden="true"
			ref={ref}
			style={{ ...dividerStyle, ...transform }}
		/>
	);
}

function TileTooltipContent({
	name,
	secondary,
}: {
	readonly name: string;
	readonly secondary?: string | undefined;
}) {
	return (
		<>
			<Text as="span" size="sm">
				{name}
			</Text>
			{secondary !== undefined && (
				<Text as="span" size="xs" variant="secondary">
					{secondary}
				</Text>
			)}
		</>
	);
}

interface TileHandlers {
	readonly mouseY: MotionValue<number>;
	readonly reduced: boolean;
	readonly layoutKey: string;
	readonly tabbable: boolean;
	readonly onFocusTile: (el: HTMLButtonElement) => void;
	readonly setRoving: () => void;
	readonly register: (key: string, el: HTMLButtonElement | null) => void;
}

function stateLabel(tile: DockTile, nowMs: number): string {
	if (tile.errored) return "errored";
	if (tile.stoppedAtMs !== undefined) {
		return `stopped ${formatRelative(tile.stoppedAtMs, nowMs)}`;
	}
	return "live";
}

function SessionTile({
	tile,
	kind,
	nowMs,
	onSelect,
	handlers,
}: {
	readonly tile: DockTile;
	readonly kind: "live" | "past";
	readonly nowMs: number;
	readonly onSelect: (id: string) => void;
	readonly handlers: TileHandlers;
}) {
	const { ref, transform } = useMagnify<HTMLButtonElement>(
		handlers.mouseY,
		handlers.layoutKey,
		handlers.reduced,
	);
	const setRef = useCallback(
		(el: HTMLButtonElement | null) => {
			ref.current = el;
			handlers.register(tile.id, el);
		},
		[ref, handlers, tile.id],
	);
	return (
		<Tooltip
			side="right"
			content={
				<TileTooltipContent
					name={tile.name}
					secondary={`${tile.place} · ${stateLabel(tile, nowMs)}`}
				/>
			}
			render={
				<motion.button
					ref={setRef}
					type="button"
					aria-current={tile.selected ? "page" : undefined}
					aria-label={tile.name}
					data-dock-key={tile.id}
					tabIndex={handlers.tabbable ? 0 : -1}
					onClick={() => onSelect(tile.id)}
					onFocus={(e: FocusEvent<HTMLButtonElement>) => {
						handlers.onFocusTile(e.currentTarget);
						handlers.setRoving();
					}}
					style={{ ...tileBaseStyle, ...transform }}
				/>
			}
		>
			<span
				aria-hidden="true"
				style={kind === "past" ? pastAvatarWrapStyle : avatarWrapStyle}
			>
				<Avatar
					colors={[...AVATAR_COLORS]}
					name={tile.name}
					size={TILE_PX}
					variant="marble"
				/>
			</span>
			{tile.selected && <span aria-hidden="true" style={selectedDotStyle} />}
			{tile.errored && <span aria-hidden="true" style={erroredDotStyle} />}
		</Tooltip>
	);
}

function GhostTile({
	count,
	expanded,
	onToggle,
	handlers,
}: {
	readonly count: number;
	readonly expanded: boolean;
	readonly onToggle: () => void;
	readonly handlers: TileHandlers;
}) {
	const { ref, transform } = useMagnify<HTMLButtonElement>(
		handlers.mouseY,
		handlers.layoutKey,
		handlers.reduced,
	);
	const setRef = useCallback(
		(el: HTMLButtonElement | null) => {
			ref.current = el;
			handlers.register(GHOST_TILE_KEY, el);
		},
		[ref, handlers],
	);
	const label = expanded ? "Hide past sessions" : `Show ${count} past sessions`;
	return (
		<Tooltip
			side="right"
			content={<TileTooltipContent name={label} />}
			render={
				<motion.button
					ref={setRef}
					type="button"
					aria-expanded={expanded}
					aria-label={label}
					data-dock-key={GHOST_TILE_KEY}
					tabIndex={handlers.tabbable ? 0 : -1}
					onClick={onToggle}
					onFocus={(e: FocusEvent<HTMLButtonElement>) => {
						handlers.onFocusTile(e.currentTarget);
						handlers.setRoving();
					}}
					style={{ ...ghostTileStyle, ...transform }}
				/>
			}
		>
			<Text as="span" variant="mono-secondary">
				{expanded ? "‹" : `+${count}`}
			</Text>
		</Tooltip>
	);
}

export function SessionDock() {
	const { state, actions } = useSessionDock();
	const { live, past, expanded, nowMs } = state;
	const reduced = useReducedMotion() ?? false;

	const navRef = useRef<HTMLElement | null>(null);
	const mouseY = useMotionValue(-Infinity);
	const mouseBottom = useMotionValue(-Infinity);
	// Panel bulge matches the wave's real overflow — (SCALE-1)·tile/2 + NUDGE —
	// not the reference's 40px (its icons magnified 2.25×; ours are subtle).
	const panelTop = useSpring(
		useTransform(mouseY, [0, 40], [0, -PANEL_BULGE]),
		SPRING,
	);
	const panelBottom = useSpring(
		useTransform(mouseBottom, [0, 40], [0, -PANEL_BULGE]),
		SPRING,
	);

	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const register = useCallback((key: string, el: HTMLButtonElement | null) => {
		if (el === null) buttons.current.delete(key);
		else buttons.current.set(key, el);
	}, []);

	const hasGhost = past.length > 0;
	const order = useMemo(
		() => dockOrder(live, past, expanded),
		[live, past, expanded],
	);

	const [rovingKey, setRovingKey] = useState<string | null>(null);
	const activeKey =
		rovingKey !== null && order.includes(rovingKey)
			? rovingKey
			: (order[0] ?? null);

	// Global ⌘1–9 selects live sessions by dock order.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			const focused = document.activeElement;
			if (
				focused instanceof HTMLElement &&
				(focused.tagName === "INPUT" ||
					focused.tagName === "TEXTAREA" ||
					focused.isContentEditable)
			) {
				return;
			}
			const digit = Number(e.key);
			if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
			const id = dockShortcutId(live, digit);
			if (id === undefined) return;
			e.preventDefault();
			actions.select(id);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [live, actions]);

	if (live.length === 0 && past.length === 0) return null;

	const onMouseMove = (e: React.MouseEvent<HTMLElement>) => {
		if (reduced) return;
		const rect = navRef.current?.getBoundingClientRect();
		if (rect === undefined) return;
		mouseY.set(e.clientY - rect.top);
		mouseBottom.set(rect.bottom - e.clientY);
	};
	const onMouseLeave = () => {
		if (reduced) return;
		mouseY.set(-Infinity);
		mouseBottom.set(-Infinity);
	};
	const onFocusTile = (el: HTMLButtonElement) => {
		if (reduced) return;
		const nav = navRef.current;
		if (nav === null) return;
		const c = el.offsetTop + el.offsetHeight / 2;
		mouseY.set(c);
		mouseBottom.set(nav.offsetHeight - c);
	};
	const onNavBlur = (e: FocusEvent<HTMLElement>) => {
		if (reduced) return;
		if (!navRef.current?.contains(e.relatedTarget)) {
			mouseY.set(-Infinity);
			mouseBottom.set(-Infinity);
		}
	};
	const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		e.preventDefault();
		const key = nextDockKey(order, activeKey, e.key === "ArrowDown" ? 1 : -1);
		if (key !== undefined) buttons.current.get(key)?.focus();
	};

	const handlers = (tabKey: string): TileHandlers => ({
		mouseY,
		reduced,
		layoutKey: `${expanded ? "e" : "c"}:${order.length}`,
		tabbable: tabKey === activeKey,
		onFocusTile,
		setRoving: () => setRovingKey(tabKey),
		register,
	});

	const showDivider = live.length > 0 && past.length > 0;

	return (
		<TooltipProvider closeDelay={0} delay={0}>
			<nav
				ref={navRef}
				aria-label="Sessions"
				style={navStyle}
				onBlur={onNavBlur}
				onKeyDown={onKeyDown}
				onMouseLeave={onMouseLeave}
				onMouseMove={onMouseMove}
			>
				<motion.div
					aria-hidden="true"
					style={{
						...panelStyle,
						top: reduced ? 0 : panelTop,
						bottom: reduced ? 0 : panelBottom,
					}}
				/>
				<div style={columnStyle}>
					{live.map((tile) => (
						<SessionTile
							key={tile.id}
							handlers={handlers(tile.id)}
							kind="live"
							nowMs={nowMs}
							onSelect={actions.select}
							tile={tile}
						/>
					))}
					{showDivider && (
						<DockDivider
							layoutKey={`${expanded ? "e" : "c"}:${order.length}`}
							mouseY={mouseY}
							reduced={reduced}
						/>
					)}
					{expanded &&
						past.map((tile) => (
							<SessionTile
								key={tile.id}
								handlers={handlers(tile.id)}
								kind="past"
								nowMs={nowMs}
								onSelect={actions.select}
								tile={tile}
							/>
						))}
					{hasGhost && (
						<GhostTile
							count={past.length}
							expanded={expanded}
							handlers={handlers(GHOST_TILE_KEY)}
							onToggle={actions.toggleExpanded}
						/>
					)}
				</div>
			</nav>
		</TooltipProvider>
	);
}

/** Rail expand/collapse — module-local state, like the header's pulse atom. */
const $dockExpanded = atom<boolean>(false);

const toggleDockExpanded = (): void => {
	$dockExpanded.set(!$dockExpanded.get());
};

/**
 * Adapts the app's nanostores into the generic dock interface. This is the only
 * place the dock touches app state; the tiles above never do.
 */
export function StoreSessionDockProvider({
	children,
}: {
	readonly children: ReactNode;
}) {
	const runs = useStore($runs);
	const pastRuns = useStore($pastRuns);
	const selected = useStore($selectedRun);
	const nowMs = useStore($nowMs);
	const expanded = useStore($dockExpanded);
	const value: SessionDockContextValue = {
		state: {
			live: buildLiveTiles(runs, selected?.id),
			past: buildPastTiles(pastRuns, selected?.id),
			expanded,
			nowMs,
		},
		actions: {
			select: selectRun,
			toggleExpanded: toggleDockExpanded,
		},
	};
	return <SessionDockProvider value={value}>{children}</SessionDockProvider>;
}
