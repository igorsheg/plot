import { useState, useEffect, useCallback, useMemo } from "react";
import type { AuthState, ProviderInfo } from "../../../../shared/rpc";
import { useAuthState } from "../../context/app-context";
import { rpc } from "../../context/rpc";

export type AuthProvider = ProviderInfo & {
	supportsOAuth: boolean;
};

export interface AuthFlowControllerState {
	providers: AuthProvider[];
	authState: AuthState;
	loading: boolean;
}

export interface AuthFlowControllerActions {
	refresh: () => Promise<void>;
	start: (providerId: string) => void;
	submit: (value: string) => void;
	saveApiKey: (providerId: string, key: string) => Promise<void>;
	removeApiKey: (providerId: string) => Promise<void>;
}

export interface AuthFlowController {
	state: AuthFlowControllerState;
	actions: AuthFlowControllerActions;
}

export function useAuthFlowController(): AuthFlowController {
	const authState = useAuthState();
	const [providers, setProviders] = useState<AuthProvider[]>([]);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		try {
			const provs = await rpc().request.getProviders({});
			setProviders(
				provs.map((p) => ({
					...p,
					supportsOAuth: p.authMode === "oauth",
				})),
			);
		} catch {
			// best effort
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	useEffect(() => {
		if (authState.phase === "success") {
			refresh();
		}
	}, [authState.phase, refresh]);

	const start = useCallback((providerId: string) => {
		rpc().request.startAuthFlow({ providerId });
	}, []);

	const submit = useCallback((value: string) => {
		rpc().request.submitAuthResponse({ value });
	}, []);

	const saveApiKey = useCallback(async (providerId: string, key: string) => {
		await rpc().request.saveApiKey({ providerId, key });
		await refresh();
	}, [refresh]);

	const removeApiKey = useCallback(async (providerId: string) => {
		await rpc().request.removeApiKey({ providerId });
		await refresh();
	}, [refresh]);

	return useMemo<AuthFlowController>(
		() => ({
			state: { providers, authState, loading },
			actions: { refresh, start, submit, saveApiKey, removeApiKey },
		}),
		[providers, authState, loading, refresh, start, submit, saveApiKey, removeApiKey],
	);
}
