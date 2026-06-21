import { useEffect, useState } from "react";

// A live render clock mirroring the TUI's syncLiveRenderTimer. The web only
// re-renders when the projection coalescer publishes — which stops when idle —
// so ages ("28s ago") and the schedule would freeze. This ticks `now` at the
// given interval: 125ms when work runs (smooth pulse), 1s when idle.
export function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return now;
}
