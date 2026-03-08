import { useRef, useState, useEffect, useCallback } from "react";
import { animate } from "motion/react";

const THRESHOLD = 30;

export function useStickToBottom<T extends HTMLElement = HTMLDivElement>() {
	const ref = useRef<T>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const userScrolledRef = useRef(false);
	const animationRef = useRef<ReturnType<typeof animate> | null>(null);

	const checkAtBottom = useCallback((el: T) => {
		const atBottom =
			el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD;
		setIsAtBottom(atBottom);
		return atBottom;
	}, []);

	const scrollToBottom = useCallback(() => {
		const el = ref.current;
		if (!el) return;

		animationRef.current?.stop();
		const from = el.scrollTop;
		const to = el.scrollHeight - el.clientHeight;
		if (Math.abs(to - from) < 1) return;

		userScrolledRef.current = false;
		animationRef.current = animate(from, to, {
			type: "spring",
			bounce: 0.05,
			duration: 0.5,
			onUpdate: (v) => {
				el.scrollTop = v;
			},
			onComplete: () => {
				setIsAtBottom(true);
			},
		});
	}, []);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		const handleScroll = () => {
			if (animationRef.current) return;
			checkAtBottom(el);
		};

		const handleWheel = () => {
			userScrolledRef.current = true;
			animationRef.current?.stop();
			animationRef.current = null;
		};

		el.addEventListener("scroll", handleScroll, { passive: true });
		el.addEventListener("wheel", handleWheel, { passive: true });
		el.addEventListener("touchmove", handleWheel, { passive: true });

		return () => {
			el.removeEventListener("scroll", handleScroll);
			el.removeEventListener("wheel", handleWheel);
			el.removeEventListener("touchmove", handleWheel);
			animationRef.current?.stop();
		};
	}, [checkAtBottom]);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		const observer = new MutationObserver(() => {
			if (!userScrolledRef.current && isAtBottom) {
				scrollToBottom();
			}
		});

		observer.observe(el, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [isAtBottom, scrollToBottom]);

	return { ref, isAtBottom, scrollToBottom };
}
