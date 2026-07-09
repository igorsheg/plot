"use client";

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type Ref,
} from "react";

export interface ScrollMetrics {
	readonly scrollTop: number;
	readonly scrollHeight: number;
	readonly clientHeight: number;
}

export const isNearBottom = (metrics: ScrollMetrics, threshold = 4): boolean =>
	metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;

export interface StickToBottomOptions {
	readonly threshold?: number;
	readonly initial?: ScrollBehavior;
	readonly resize?: ScrollBehavior;
}

const useBrowserLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

const setRef = <T,>(ref: Ref<T> | undefined, value: T | null): void => {
	if (ref === undefined || ref === null) return;
	if (typeof ref === "function") {
		ref(value);
		return;
	}
	ref.current = value;
};

export const mergeRefs =
	<T,>(...refs: readonly (Ref<T> | undefined)[]): Ref<T> =>
	(value) => {
		for (const ref of refs) setRef(ref, value);
	};

export function useStickToBottom<
	ScrollElement extends HTMLElement = HTMLDivElement,
	ContentElement extends HTMLElement = HTMLDivElement,
>(
	options: StickToBottomOptions = {},
): {
	readonly scrollRef: Ref<ScrollElement>;
	readonly contentRef: Ref<ContentElement>;
	readonly isAtBottom: boolean;
	readonly scrollToBottom: (behavior?: ScrollBehavior) => boolean;
} {
	const threshold = options.threshold ?? 4;
	const scrollElement = useRef<ScrollElement | null>(null);
	const contentElement = useRef<ContentElement | null>(null);
	const stickToBottom = useRef(true);
	const frame = useRef<number | undefined>(undefined);
	const [isAtBottom, setIsAtBottom] = useState(true);

	const measure = useCallback((): boolean => {
		const element = scrollElement.current;
		if (element === null) return true;
		const next = isNearBottom(element, threshold);
		setIsAtBottom(next);
		return next;
	}, [threshold]);

	const scrollToBottom = useCallback(
		(behavior: ScrollBehavior = "auto"): boolean => {
			const element = scrollElement.current;
			if (element === null) return false;
			element.scrollTo({
				top: Math.max(0, element.scrollHeight - element.clientHeight),
				behavior,
			});
			stickToBottom.current = true;
			setIsAtBottom(true);
			return true;
		},
		[],
	);

	const scheduleStick = useCallback(
		(behavior: ScrollBehavior = "auto") => {
			if (frame.current !== undefined) cancelAnimationFrame(frame.current);
			frame.current = requestAnimationFrame(() => {
				frame.current = undefined;
				if (stickToBottom.current) {
					scrollToBottom(behavior);
					return;
				}
				measure();
			});
		},
		[measure, scrollToBottom],
	);

	const scrollRef = useCallback((node: ScrollElement | null): void => {
		scrollElement.current = node;
	}, []);

	const contentRef = useCallback((node: ContentElement | null): void => {
		contentElement.current = node;
	}, []);

	useBrowserLayoutEffect(() => {
		const scrollNode = scrollElement.current;
		if (scrollNode === null) return;

		const onScroll = () => {
			const next = measure();
			stickToBottom.current = next;
		};
		scrollNode.addEventListener("scroll", onScroll, { passive: true });
		scheduleStick(options.initial ?? "auto");

		const ResizeObserverCtor = globalThis.ResizeObserver;
		const resizeObserver =
			ResizeObserverCtor === undefined
				? undefined
				: new ResizeObserverCtor(() => scheduleStick(options.resize ?? "auto"));
		resizeObserver?.observe(scrollNode);
		if (contentElement.current !== null)
			resizeObserver?.observe(contentElement.current);

		return () => {
			scrollNode.removeEventListener("scroll", onScroll);
			resizeObserver?.disconnect();
			if (frame.current !== undefined) {
				cancelAnimationFrame(frame.current);
				frame.current = undefined;
			}
		};
	}, [measure, options.initial, options.resize, scheduleStick]);

	return { scrollRef, contentRef, isAtBottom, scrollToBottom };
}
