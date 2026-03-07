import { use, createContext, useMemo, useState, type ReactNode } from "react";

export interface DashboardState {
	focusedIssueId: string | null;
}

export interface DashboardActions {
	focusIssue: (id: string | null) => void;
}

export interface DashboardContextValue {
	state: DashboardState;
	actions: DashboardActions;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
	const ctx = use(DashboardContext);
	if (!ctx)
		throw new Error(
			"Dashboard compound components must be used within Dashboard.Root",
		);
	return ctx;
}

export function Root({ children }: { children: ReactNode }) {
	const [focusedIssueId, setFocusedIssueId] = useState<string | null>(null);

	const value = useMemo(
		() => ({
			state: { focusedIssueId },
			actions: { focusIssue: setFocusedIssueId },
		}),
		[focusedIssueId],
	);

	return (
		<DashboardContext value={value}>
			<div className="flex min-h-screen flex-col">{children}</div>
		</DashboardContext>
	);
}
