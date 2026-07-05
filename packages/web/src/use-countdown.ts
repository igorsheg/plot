import { useEffect, useState } from "react";

export const useNow = (intervalMs = 1000): number => {
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		const interval = setInterval(() => setNowMs(Date.now()), intervalMs);
		return () => clearInterval(interval);
	}, [intervalMs]);
	return nowMs;
};

export const formatClockDuration = (ms: number): string => {
	const seconds = Math.max(0, Math.ceil(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

export const useCountdown = (
	dueAtMs: number | undefined,
):
	| {
			readonly due: boolean;
			readonly remainingMs: number;
			readonly text: string;
	  }
	| undefined => {
	const nowMs = useNow();
	if (dueAtMs === undefined) return undefined;
	const remainingMs = dueAtMs - nowMs;
	return {
		due: remainingMs <= 0,
		remainingMs,
		text: remainingMs <= 0 ? "scan due" : formatClockDuration(remainingMs),
	};
};
