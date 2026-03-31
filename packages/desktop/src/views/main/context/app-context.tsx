import { createContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import type { ProjectInfo, AuthState } from "../../../shared/rpc";
import { rpc } from "./rpc";

interface AppState {
	project: ProjectInfo | null;
	loading: boolean;
}

interface AppActions {
	refreshProject: () => void;
}

export interface AppContextValue {
	state: AppState;
	actions: AppActions;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAuthState(): AuthState {
	const [authState, setAuthState] = useState<AuthState>({ phase: "idle", providerId: null });

	useEffect(() => {
		const handler = (e: Event) => {
			setAuthState((e as CustomEvent<AuthState>).detail);
		};
		window.addEventListener("plot:auth-state", handler);
		return () => window.removeEventListener("plot:auth-state", handler);
	}, []);

	return authState;
}

function getProjectIdFromUrl(): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get("projectId");
}

export function AppProvider({ children }: { children: ReactNode }) {
	const [project, setProject] = useState<ProjectInfo | null>(null);
	const [loading, setLoading] = useState(true);

	const projectId = getProjectIdFromUrl();

	useEffect(() => {
		if (!projectId) {
			setLoading(false);
			return;
		}
		rpc().request.getProjectInfo({ projectId }).then((info) => {
			setProject(info);
			setLoading(false);
		}).catch(() => setLoading(false));
	}, [projectId]);

	useEffect(() => {
		const handler = (e: Event) => {
			const updated = (e as CustomEvent<ProjectInfo>).detail;
			setProject((prev) => (prev && prev.id === updated.id ? updated : prev));
		};
		window.addEventListener("plot:project-updated", handler);
		return () => window.removeEventListener("plot:project-updated", handler);
	}, []);

	const refreshProject = useCallback(() => {
		if (!projectId) return;
		rpc().request.getProjectInfo({ projectId }).then((info) => {
			setProject(info);
		});
	}, [projectId]);

	const value = useMemo<AppContextValue>(() => ({
		state: { project, loading },
		actions: { refreshProject },
	}), [project, loading, refreshProject]);

	return <AppContext value={value}>{children}</AppContext>;
}
