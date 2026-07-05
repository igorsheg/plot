import { useEffect, useRef, useState } from "react";

const keyFor = (sessionId: string): string => `plot:lastSeen:${sessionId}`;

export const readLastSeenAnchor = (
	sessionId: string | undefined,
): number | undefined => {
	if (sessionId === undefined) return undefined;
	try {
		const value = Number(localStorage.getItem(keyFor(sessionId)));
		return Number.isFinite(value) && value > 0 ? value : undefined;
	} catch {
		return undefined;
	}
};

const writeSeen = (sessionId: string): void => {
	try {
		localStorage.setItem(keyFor(sessionId), String(Date.now()));
	} catch {
		// ponytail: last-seen persistence is advisory; the brief still renders.
	}
};

export const useLastSeen = (
	sessionId: string | undefined,
): number | undefined => {
	const [anchorMs, setAnchorMs] = useState<number | undefined>(() =>
		readLastSeenAnchor(sessionId),
	);
	const previousSessionIdRef = useRef<string | undefined>(sessionId);
	useEffect(() => {
		const previousSessionId = previousSessionIdRef.current;
		if (previousSessionId !== sessionId) {
			if (previousSessionId !== undefined) writeSeen(previousSessionId);
			previousSessionIdRef.current = sessionId;
		}
		setAnchorMs(readLastSeenAnchor(sessionId));
		if (sessionId === undefined) return;
		const onPageHide = () => writeSeen(sessionId);
		const onVisibilityChange = () => {
			if (document.visibilityState === "hidden") writeSeen(sessionId);
		};
		window.addEventListener("pagehide", onPageHide);
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			window.removeEventListener("pagehide", onPageHide);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [sessionId]);
	return anchorMs;
};
