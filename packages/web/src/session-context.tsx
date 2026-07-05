import { createContext, use, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ObservationInput, WebDashboardProjection } from "./api.js";
import type { PlotRun } from "./run.js";

interface SessionContextValue {
	readonly state: {
		readonly run: PlotRun;
		readonly projection: WebDashboardProjection | undefined;
		readonly liveProjection: WebDashboardProjection | undefined;
		readonly live: boolean | undefined;
		readonly scrubbing: boolean;
		readonly playheadMs: number | undefined;
		readonly historyTruncated: boolean;
	};
	readonly actions: {
		readonly act: (input: ObservationInput) => Promise<boolean>;
		readonly stop: () => void;
		readonly scrubTo: (input: {
			readonly playheadMs: number;
			readonly projection: WebDashboardProjection | undefined;
			readonly historyTruncated?: boolean | undefined;
		}) => void;
		readonly endScrub: () => void;
	};
	readonly meta: { readonly sessionRunId: string };
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
	act,
	children,
	live,
	projection,
	run,
	stop,
}: {
	readonly act: (input: ObservationInput) => Promise<boolean>;
	readonly children: ReactNode;
	readonly live: boolean | undefined;
	readonly projection: WebDashboardProjection | undefined;
	readonly run: PlotRun;
	readonly stop: () => void;
}) {
	const [scrub, setScrub] = useState<{
		readonly playheadMs: number;
		readonly projection: WebDashboardProjection | undefined;
		readonly historyTruncated: boolean;
	}>();
	useEffect(() => setScrub(undefined), [run.id]);
	return (
		<SessionContext
			value={{
				state: {
					run,
					projection: scrub?.projection ?? projection,
					liveProjection: projection,
					live,
					scrubbing: scrub !== undefined,
					playheadMs: scrub?.playheadMs,
					historyTruncated: scrub?.historyTruncated ?? false,
				},
				actions: {
					act,
					stop,
					scrubTo: (input) =>
						setScrub({
							playheadMs: input.playheadMs,
							projection: input.projection,
							historyTruncated: input.historyTruncated ?? false,
						}),
					endScrub: () => setScrub(undefined),
				},
				meta: { sessionRunId: run.id },
			}}
		>
			{children}
		</SessionContext>
	);
}

export const useOptionalSession = (): SessionContextValue | undefined => {
	const value = use(SessionContext);
	return value ?? undefined;
};

export const useSession = (): SessionContextValue => {
	const value = useOptionalSession();
	if (value === undefined)
		throw new Error("useSession outside SessionProvider");
	return value;
};
