import { createContext, use, useState, useEffect, useMemo, type ReactNode } from "react";
import { Badge } from "@plot/ui/components/badge";
import { Button } from "@plot/ui/components/button";
import { Input } from "@plot/ui/components/input";
import { Spinner } from "@plot/ui/components/spinner";
import { Alert, AlertDescription } from "@plot/ui/components/alert";
import { Check, AlertTriangle, Info } from "lucide-react";
import type { AuthFlowController, AuthProvider } from "./use-auth-flow-controller";

// ── Per-provider context ─────────────────────────────

interface AuthFlowProviderState {
	providerId: string;
	provider: AuthProvider | null;
	authenticated: boolean;
	supportsOAuth: boolean;
	phase: "idle" | "authenticating" | "waitingForCode" | "success" | "failed";
	active: boolean;
	message: string | null;
	placeholder?: string;
	error: string | null;
}

interface AuthFlowProviderActions {
	connect: () => void;
	submit: (value: string) => void;
	saveApiKey: (key: string) => Promise<void>;
	removeApiKey: () => Promise<void>;
}

interface AuthFlowProviderMeta {
	requiresAuth: boolean;
	canConnect: boolean;
	canProceed: boolean;
}

export interface AuthFlowContextValue {
	state: AuthFlowProviderState;
	actions: AuthFlowProviderActions;
	meta: AuthFlowProviderMeta;
}

const AuthFlowContext = createContext<AuthFlowContextValue | null>(null);

export function useAuthFlowProvider(): AuthFlowContextValue {
	const ctx = use(AuthFlowContext);
	if (!ctx) throw new Error("AuthFlow.* must be used inside AuthFlow.Provider");
	return ctx;
}

// ── Provider ─────────────────────────────────────────

function Provider({
	controller,
	providerId,
	children,
}: {
	controller: AuthFlowController;
	providerId: string;
	children: ReactNode;
}) {
	const { state: ctrlState, actions: ctrlActions } = controller;
	const { authState, providers } = ctrlState;

	const value = useMemo<AuthFlowContextValue>(() => {
		const provider = providers.find((p) => p.id === providerId) ?? null;
		const active =
			"providerId" in authState && authState.providerId === providerId;
		const phase = active ? authState.phase : "idle";
		// Trust provider.authenticated as source of truth; only boost via authState during active flow
		const authenticated = provider?.authenticated === true;
		const supportsOAuth = provider?.supportsOAuth ?? false;
		const busy =
			authState.phase === "authenticating" ||
			authState.phase === "waitingForCode";
		const canConnect = supportsOAuth && (!busy || active);

		return {
			state: {
				providerId,
				provider,
				authenticated,
				supportsOAuth,
				phase: phase as AuthFlowProviderState["phase"],
				active,
				message:
					active && authState.phase === "waitingForCode"
						? authState.message
						: null,
				placeholder:
					active && authState.phase === "waitingForCode"
						? authState.placeholder
						: undefined,
				error:
					active && authState.phase === "failed" ? authState.error : null,
			},
			actions: {
				connect: () => ctrlActions.start(providerId),
				submit: (value: string) => ctrlActions.submit(value),
				saveApiKey: (key: string) => ctrlActions.saveApiKey(providerId, key),
				removeApiKey: () => ctrlActions.removeApiKey(providerId),
			},
			meta: {
				requiresAuth: !authenticated,
				canConnect,
				canProceed: authenticated,
			},
		};
	}, [providerId, ctrlState, ctrlActions, authState, providers]);

	return <AuthFlowContext value={value}>{children}</AuthFlowContext>;
}

// ── Badge ────────────────────────────────────────────

function AuthBadge({ className }: { className?: string }) {
	const { state } = useAuthFlowProvider();

	if (state.authenticated && state.phase !== "success") {
		return (
			<Badge variant="success" size="sm" className={className}>
				Connected
			</Badge>
		);
	}

	switch (state.phase) {
		case "authenticating":
			return (
				<Badge variant="info" size="sm" className={className}>
					Authenticating
				</Badge>
			);
		case "waitingForCode":
			return (
				<Badge variant="warning" size="sm" className={className}>
					Action required
				</Badge>
			);
		case "success":
			return (
				<Badge variant="success" size="sm" className={className}>
					Connected
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="error" size="sm" className={className}>
					Failed
				</Badge>
			);
		default:
			return (
				<Badge variant="outline" size="sm" className={className}>
					Not connected
				</Badge>
			);
	}
}

// ── Connect Button ───────────────────────────────────

function ConnectButton({
	children,
	...props
}: Omit<React.ComponentProps<typeof Button>, "onClick"> & {
	children?: ReactNode;
}) {
	const { state, actions, meta } = useAuthFlowProvider();

	if (state.authenticated) return null;

	if (!state.supportsOAuth) {
		return null;
	}

	const label =
		children ??
		(state.phase === "failed" ? "Retry" : "Connect");

	return (
		<Button
			variant="outline"
			size="sm"
			onClick={actions.connect}
			disabled={!meta.canConnect}
			{...props}
		>
			{label}
		</Button>
	);
}

// ── API Key Input ────────────────────────────────────

function ApiKeyInput({ className }: { className?: string }) {
	const { state, actions } = useAuthFlowProvider();
	const [key, setKey] = useState("");
	const [saving, setSaving] = useState(false);

	// Clear input when auth status changes to authenticated
	useEffect(() => {
		if (state.authenticated) {
			setKey("");
		}
	}, [state.authenticated]);

	if (state.supportsOAuth) return null;
	if (state.authenticated) {
		return (
			<div className={`flex items-center justify-between gap-2 ${className ?? ""}`}>
				<p className="text-[12px] text-muted-foreground">API key configured</p>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => actions.removeApiKey()}
					className="text-destructive hover:text-destructive"
				>
					Remove
				</Button>
			</div>
		);
	}

	const handleSave = async () => {
		if (!key.trim()) return;
		setSaving(true);
		try {
			await actions.saveApiKey(key.trim());
			setKey("");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className={`space-y-2 ${className ?? ""}`}>
			<div className="flex gap-2">
				<Input
					size="sm"
					type="password"
					value={key}
					onChange={(e) => setKey(e.target.value)}
					placeholder="sk-..."
					className="flex-1"
					onKeyDown={(e) => {
						if (e.key === "Enter" && key.trim()) {
							handleSave();
						}
					}}
				/>
				<Button
					size="sm"
					onClick={handleSave}
					disabled={!key.trim() || saving}
				>
					{saving ? "Saving..." : "Save"}
				</Button>
			</div>
		</div>
	);
}

// ── Status Inline ────────────────────────────────────

function StatusInline({ className }: { className?: string }) {
	const { state, actions } = useAuthFlowProvider();
	const [input, setInput] = useState("");

	if (!state.active) return null;

	switch (state.phase) {
		case "authenticating":
			return (
				<div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
					<div className="flex items-center gap-2 text-[12px] text-muted-foreground">
						<Spinner className="size-3" />
						<span>Complete authentication in your browser</span>
					</div>
					<p className="text-[11px] text-muted-foreground/50">
						Waiting for confirmation...
					</p>
				</div>
			);

		case "waitingForCode":
			return (
				<div className={`space-y-2 ${className ?? ""}`}>
					{state.message && (
						<p className="text-[12px] text-muted-foreground">{state.message}</p>
					)}
					<div className="flex gap-2">
						<Input
							size="sm"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={state.placeholder}
							className="flex-1"
							onKeyDown={(e) => {
								if (e.key === "Enter" && input) {
									actions.submit(input);
									setInput("");
								}
							}}
						/>
						<Button
							size="sm"
							onClick={() => {
								actions.submit(input);
								setInput("");
							}}
							disabled={!input}
						>
							Submit
						</Button>
					</div>
				</div>
			);

		case "success":
			return (
				<p className={`text-[12px] text-success-foreground ${className ?? ""}`}>
					Connected
				</p>
			);

		case "failed":
			return (
				<p className={`text-[12px] text-destructive ${className ?? ""}`}>
					{state.error ?? "Authentication failed"}
				</p>
			);

		default:
			return null;
	}
}

// ── Status Alert ─────────────────────────────────────

function StatusAlert({ className }: { className?: string }) {
	const { state, actions } = useAuthFlowProvider();
	const [input, setInput] = useState("");

	if (!state.active) return null;

	switch (state.phase) {
		case "authenticating":
			return (
				<Alert variant="info" className={className}>
					<Info className="size-4" />
					<AlertDescription>Complete authentication in your browser</AlertDescription>
				</Alert>
			);

		case "waitingForCode":
			return (
				<Alert variant="info" className={className}>
					<Info className="size-4" />
					<AlertDescription>
						{state.message && (
							<p className="text-xs mb-1.5">{state.message}</p>
						)}
						<div className="flex gap-2">
							<Input
								size="sm"
								value={input}
								onChange={(e) => setInput(e.target.value)}
								placeholder={state.placeholder}
								className="flex-1"
								onKeyDown={(e) => {
									if (e.key === "Enter" && input) {
										actions.submit(input);
										setInput("");
									}
								}}
							/>
							<Button
								size="sm"
								onClick={() => {
									actions.submit(input);
									setInput("");
								}}
								disabled={!input}
							>
								Submit
							</Button>
						</div>
					</AlertDescription>
				</Alert>
			);

		case "success":
			return (
				<Alert variant="success" className={className}>
					<Check className="size-4" />
					<AlertDescription>Connected</AlertDescription>
				</Alert>
			);

		case "failed":
			return (
				<Alert variant="error" className={className}>
					<AlertTriangle className="size-4" />
					<AlertDescription>
						{state.error ?? "Authentication failed"}
					</AlertDescription>
				</Alert>
			);

		default:
			return null;
	}
}

// ── Export ────────────────────────────────────────────

export const AuthFlow = {
	Provider,
	Badge: AuthBadge,
	ConnectButton,
	ApiKeyInput,
	Status: {
		Inline: StatusInline,
		Alert: StatusAlert,
	},
};
