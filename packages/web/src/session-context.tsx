import { createContext, use } from "react";
import type { ReactNode } from "react";
import type { ObservationInput, WebDashboardProjection } from "./api.js";
import type { PlotRun } from "./run.js";

interface SessionContextValue {
	readonly state: {
		readonly run: PlotRun;
		readonly projection: WebDashboardProjection | undefined;
		readonly live: boolean | undefined;
	};
	readonly actions: {
		readonly act: (input: ObservationInput) => Promise<boolean>;
		readonly stop: () => void;
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
	return (
		<SessionContext
			value={{
				state: { run, projection, live },
				actions: { act, stop },
				meta: { sessionRunId: run.id },
			}}
		>
			{children}
		</SessionContext>
	);
}

export const useSession = (): SessionContextValue => {
	const value = use(SessionContext);
	if (value === null) throw new Error("useSession outside SessionProvider");
	return value;
};
