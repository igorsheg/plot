/**
 * Session dock — a left-docked line navigator. The selected session is the only
 * row that shows text by default; hover/focus reveals any other row's title.
 * Attention is a line treatment, not a badge: errored sessions draw a longer
 * destructive line even while collapsed.
 */

import { useStore } from "@nanostores/react";
import { atom } from "nanostores";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	$pastSessions,
	$sessions,
	$selectedSession,
	selectSession,
} from "../../app/sessions-store.js";
import { $nowMs } from "../../app/time-store.js";
import { formatRelative } from "../../lib/relative-time.js";
import { Text } from "../ui/text.js";
import {
	SessionDockProvider,
	useSessionDock,
	type SessionDockContextValue,
} from "./context.js";
import {
	DEFAULT_DOCK_MOTION,
	dockMotionVars,
	type DockMotion,
} from "./motion.js";
import {
	dockLineButtonClass,
	dockLineClass,
	dockLineTitleShellClass,
	dockNavClass,
} from "./styles.js";
import {
	buildLiveLines,
	buildPastLines,
	dockLineOrder,
	dockShortcutId,
	GHOST_LINE_KEY,
	nextDockKey,
	type DockLineItem,
} from "./view-model.js";

interface LineHandlers {
	readonly tabbable: boolean;
	readonly setRoving: () => void;
	readonly register: (key: string, el: HTMLButtonElement | null) => void;
}

const statusLabel = (item: DockLineItem, nowMs: number): string => {
	if (item.attention) return "errored";
	if (item.stoppedAtMs !== undefined)
		return `stopped ${formatRelative(item.stoppedAtMs, nowMs)}`;
	return "live";
};

function DockLine({
	id,
	title,
	selected,
	attention,
	onClick,
	handlers,
	ariaLabel,
}: {
	readonly id: string;
	readonly title: string;
	readonly selected: boolean;
	readonly attention: boolean;
	readonly onClick: () => void;
	readonly handlers: LineHandlers;
	readonly ariaLabel: string;
}) {
	const setRef = useCallback(
		(el: HTMLButtonElement | null) => handlers.register(id, el),
		[handlers, id],
	);
	const pointerActivation = useRef(false);
	const textVariant = attention ? "error" : selected ? "body" : "secondary";
	const visible = selected;
	const size = selected ? "active" : attention ? "attention" : "normal";
	return (
		<button
			ref={setRef}
			type="button"
			aria-current={selected ? "page" : undefined}
			aria-label={ariaLabel}
			className={dockLineButtonClass({ visible })}
			data-dock-key={id}
			tabIndex={handlers.tabbable ? 0 : -1}
			onClick={(event) => {
				onClick();
				if (pointerActivation.current) event.currentTarget.blur();
				pointerActivation.current = false;
			}}
			onFocus={() => handlers.setRoving()}
			onPointerDown={() => {
				pointerActivation.current = true;
			}}
		>
			<span
				aria-hidden="true"
				className={dockLineClass({
					size,
					tone: attention ? "attention" : "default",
				})}
			/>
			<span className={dockLineTitleShellClass({ visible })}>
				<Text as="span" size="sm" variant={textVariant}>
					{title}
				</Text>
			</span>
		</button>
	);
}

interface RenderedLine {
	readonly id: string;
	readonly title: string;
	readonly selected: boolean;
	readonly attention: boolean;
	readonly ariaLabel: string;
	readonly onClick: () => void;
}

export function SessionDock({
	motion: motionProp,
}: {
	readonly motion?: Partial<DockMotion>;
} = {}) {
	const { state, actions } = useSessionDock();
	const { live, past, expanded, nowMs } = state;
	const anim = { ...DEFAULT_DOCK_MOTION, ...motionProp };
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const register = useCallback((key: string, el: HTMLButtonElement | null) => {
		if (el === null) buttons.current.delete(key);
		else buttons.current.set(key, el);
	}, []);

	const hasGhost = past.length > 0;
	const order = useMemo(
		() => dockLineOrder(live, past, expanded),
		[live, past, expanded],
	);
	const selectedKey = useMemo(
		() => [...live, ...past].find((item) => item.selected)?.id ?? null,
		[live, past],
	);
	const [rovingKey, setRovingKey] = useState<string | null>(null);
	const activeKey =
		rovingKey !== null && order.includes(rovingKey)
			? rovingKey
			: (selectedKey ?? order[0] ?? null);

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

	const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		e.preventDefault();
		const key = nextDockKey(order, activeKey, e.key === "ArrowDown" ? 1 : -1);
		if (key !== undefined) buttons.current.get(key)?.focus();
	};

	const handlers = (tabKey: string): LineHandlers => ({
		tabbable: tabKey === activeKey,
		setRoving: () => setRovingKey(tabKey),
		register,
	});

	const rendered: RenderedLine[] = [
		...live.map((item) => ({
			id: item.id,
			title: item.title,
			selected: item.selected,
			attention: item.attention,
			ariaLabel: `${item.title}, ${item.place}, ${statusLabel(item, nowMs)}`,
			onClick: () => actions.select(item.id),
		})),
		...(expanded
			? past.map((item) => ({
					id: item.id,
					title: item.title,
					selected: item.selected,
					attention: item.attention,
					ariaLabel: `${item.title}, ${item.place}, ${statusLabel(item, nowMs)}`,
					onClick: () => actions.select(item.id),
				}))
			: []),
		...(hasGhost
			? [
					{
						id: GHOST_LINE_KEY,
						title: expanded
							? "Hide past sessions"
							: `${past.length} past sessions`,
						selected: false,
						attention: false,
						ariaLabel: expanded
							? "Hide past sessions"
							: `Show ${past.length} past sessions`,
						onClick: actions.toggleExpanded,
					},
				]
			: []),
	];

	return (
		<nav
			aria-label="Sessions"
			className={dockNavClass()}
			onKeyDown={onKeyDown}
			style={dockMotionVars(anim)}
		>
			{rendered.map((line) => (
				<DockLine
					key={line.id}
					ariaLabel={line.ariaLabel}
					attention={line.attention}
					handlers={handlers(line.id)}
					id={line.id}
					onClick={line.onClick}
					selected={line.selected}
					title={line.title}
				/>
			))}
		</nav>
	);
}

/** Rail expand/collapse — module-local state. */
const $dockExpanded = atom<boolean>(false);

const toggleDockExpanded = (): void => {
	$dockExpanded.set(!$dockExpanded.get());
};

/**
 * Adapts the app's nanostores into the generic dock interface. This is the only
 * place the dock touches app state; the lines above never do.
 */
export function StoreSessionDockProvider({
	children,
}: {
	readonly children: ReactNode;
}) {
	const sessions = useStore($sessions);
	const pastSessions = useStore($pastSessions);
	const selected = useStore($selectedSession);
	const nowMs = useStore($nowMs);
	const expanded = useStore($dockExpanded);
	const value: SessionDockContextValue = {
		state: {
			live: buildLiveLines(sessions, selected?.id),
			past: buildPastLines(pastSessions, selected?.id),
			expanded,
			nowMs,
		},
		actions: {
			select: selectSession,
			toggleExpanded: toggleDockExpanded,
		},
	};
	return <SessionDockProvider value={value}>{children}</SessionDockProvider>;
}
