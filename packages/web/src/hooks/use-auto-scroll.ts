import { useEffect, useRef, type RefObject } from "react";

// Keeps a scroll container pinned to its bottom as content streams in — but only
// while the user is already near the bottom. Scrolling up to read history
// detaches the follow until you return to the end. Adapted from opencode's
// auto-scroll behaviour. `dep` should change whenever new content arrives
// (e.g. the entry count).
export function useAutoScroll<T extends HTMLElement>(
	dep: unknown,
): RefObject<T | null> {
	const ref = useRef<T | null>(null);
	const pinned = useRef(true);

	// Re-runs whenever new content arrives (and when the container first mounts,
	// e.g. a collapsed panel opening): (re)binds the scroll listener and, while
	// pinned, snaps to the bottom.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const onScroll = () => {
			pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		if (pinned.current) el.scrollTop = el.scrollHeight;
		return () => el.removeEventListener("scroll", onScroll);
	}, [dep]);

	return ref;
}
