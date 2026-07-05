import {
	createContext,
	createElement,
	use,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { ReactNode } from "react";
import type { ObservationInput } from "./api.js";

export type QueuedActionStatus = "pending" | "sending" | "failed" | "sent";

export interface QueuedAction {
	readonly id: string;
	readonly input: ObservationInput;
	readonly label: string;
	readonly enqueuedAtMs: number;
	readonly sendAtMs: number;
	readonly status: QueuedActionStatus;
	readonly error?: string | undefined;
}

export interface ActionQueueState {
	readonly items: readonly QueuedAction[];
}

export const emptyActionQueueState: ActionQueueState = { items: [] };

export const enqueueQueuedAction = (
	state: ActionQueueState,
	action: QueuedAction,
): ActionQueueState => ({ ...state, items: [...state.items, action] });

export const cancelQueuedAction = (
	state: ActionQueueState,
	id: string,
): ActionQueueState => ({
	...state,
	items: state.items.filter(
		(action) => action.id !== id || action.status !== "pending",
	),
});

export const undoLatestQueuedAction = (
	state: ActionQueueState,
): ActionQueueState => {
	const index = state.items.findLastIndex(
		(action) => action.status === "pending",
	);
	return index === -1
		? state
		: {
				...state,
				items: state.items.filter((_, itemIndex) => itemIndex !== index),
			};
};

export const markQueuedActionSending = (
	state: ActionQueueState,
	id: string,
): ActionQueueState => ({
	...state,
	items: state.items.map((action) =>
		action.id === id && action.status === "pending"
			? { ...action, status: "sending" }
			: action,
	),
});

export const markQueuedActionSent = (
	state: ActionQueueState,
	id: string,
): ActionQueueState => ({
	...state,
	items: state.items.map((action) =>
		action.id === id ? { ...action, status: "sent" } : action,
	),
});

export const removeQueuedAction = (
	state: ActionQueueState,
	id: string,
): ActionQueueState => ({
	...state,
	items: state.items.filter((action) => action.id !== id),
});

export const markQueuedActionFailed = (
	state: ActionQueueState,
	id: string,
	error: string,
): ActionQueueState => ({
	...state,
	items: state.items.map((action) =>
		action.id === id ? { ...action, status: "failed", error } : action,
	),
});

export const retryQueuedAction = (
	state: ActionQueueState,
	id: string,
	nowMs: number,
): ActionQueueState => ({
	...state,
	items: state.items.map((action) =>
		action.id === id && action.status === "failed"
			? { ...action, status: "pending", sendAtMs: nowMs, error: undefined }
			: action,
	),
});

export const dueQueuedActions = (
	state: ActionQueueState,
	nowMs: number,
): readonly QueuedAction[] =>
	state.items.filter(
		(action) => action.status === "pending" && action.sendAtMs <= nowMs,
	);

const errorText = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught);

const randomId = (): string =>
	globalThis.crypto?.randomUUID?.() ??
	`aq-${Math.random().toString(36).slice(2)}`;

interface ActionQueueContextValue {
	readonly state: ActionQueueState;
	readonly actions: {
		readonly enqueue: (input: ObservationInput) => string;
		readonly cancel: (id: string) => void;
		readonly retry: (id: string) => void;
		readonly undoLatest: () => void;
	};
	readonly meta: {
		readonly delayMs: number;
	};
}

const ActionQueueContext = createContext<ActionQueueContextValue | null>(null);

export function ActionQueueProvider({
	children,
	delayMs = 5_000,
	record,
}: {
	readonly children: ReactNode;
	readonly delayMs?: number | undefined;
	readonly record: (input: ObservationInput) => Promise<boolean>;
}) {
	const [state, setState] = useState<ActionQueueState>(emptyActionQueueState);
	const timers = useRef(new Map<string, number>());
	const send = useCallback(
		async (action: QueuedAction) => {
			setState((current) => markQueuedActionSending(current, action.id));
			try {
				const accepted = await record(action.input);
				setState((current) =>
					accepted
						? markQueuedActionSent(current, action.id)
						: markQueuedActionFailed(
								current,
								action.id,
								"rejected · session queue is full, try again",
							),
				);
			} catch (caught) {
				setState((current) =>
					markQueuedActionFailed(current, action.id, errorText(caught)),
				);
			}
		},
		[record],
	);

	useEffect(() => {
		const timedIds = new Set(
			state.items
				.filter(
					(action) => action.status === "pending" || action.status === "sent",
				)
				.map((action) => action.id),
		);
		for (const [id, timer] of timers.current) {
			if (!timedIds.has(id)) {
				window.clearTimeout(timer);
				timers.current.delete(id);
			}
		}
		for (const action of state.items) {
			if (timers.current.has(action.id)) continue;
			if (action.status === "pending") {
				const timer = window.setTimeout(
					() => {
						timers.current.delete(action.id);
						void send(action);
					},
					Math.max(0, action.sendAtMs - Date.now()),
				);
				timers.current.set(action.id, timer);
			}
			if (action.status === "sent") {
				const timer = window.setTimeout(() => {
					timers.current.delete(action.id);
					setState((current) => removeQueuedAction(current, action.id));
				}, 1_500);
				timers.current.set(action.id, timer);
			}
		}
	}, [send, state.items]);

	useEffect(
		() => () => {
			for (const timer of timers.current.values()) window.clearTimeout(timer);
			timers.current.clear();
		},
		[],
	);

	const enqueue = useCallback(
		(input: ObservationInput): string => {
			const nowMs = Date.now();
			const id = randomId();
			setState((current) =>
				enqueueQueuedAction(current, {
					id,
					input: {
						...input,
						clientId: input.clientId ?? randomId(),
					},
					label: input.actionLabel,
					enqueuedAtMs: nowMs,
					sendAtMs: nowMs + delayMs,
					status: "pending",
				}),
			);
			return id;
		},
		[delayMs],
	);

	const value: ActionQueueContextValue = {
		state,
		actions: {
			enqueue,
			cancel: (id) => setState((current) => cancelQueuedAction(current, id)),
			retry: (id) =>
				setState((current) => retryQueuedAction(current, id, Date.now())),
			undoLatest: () => setState(undoLatestQueuedAction),
		},
		meta: { delayMs },
	};

	return createElement(ActionQueueContext, { value }, children);
}

export const useOptionalActionQueue = ():
	| ActionQueueContextValue
	| undefined => {
	const value = use(ActionQueueContext);
	return value ?? undefined;
};

export const useActionQueue = (): ActionQueueContextValue => {
	const value = useOptionalActionQueue();
	if (value === undefined)
		throw new Error("useActionQueue outside ActionQueueProvider");
	return value;
};
