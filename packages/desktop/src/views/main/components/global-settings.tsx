import { useState, useRef, useEffect } from "react";
import { Cpu, Link, RefreshCw, Unlink } from "lucide-react";
import Avatar from "boring-avatars";
import { WindowChrome } from "./window-chrome";
import {
	useAuthFlowController,
	AuthFlow,
	useAuthFlowProvider,
} from "./auth-flow";
import { Button } from "@plot/ui/components/button";
import { Input } from "@plot/ui/components/input";

import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarInset,
} from "@plot/ui/components/sidebar";

function OAuthCard() {
	const { state, actions } = useAuthFlowProvider();

	return (
		<div className="rounded-lg bg-muted/40 p-2 space-y-2">
			<div className="flex items-center gap-2">
				<span className="flex-1 text-xs font-medium">{state.provider?.name}</span>
				<Button
					size="xs"
					variant="ghost"
					onClick={() => actions.connect()}
				>
					{state.authenticated ? <><RefreshCw className="size-3.5" /> Reconnect</> : <><Link className="size-3.5" /> Connect</>}
				</Button>
				<div
					className={`size-1.5 shrink-0 rounded-full ${
						state.authenticated ? "bg-emerald-500" : "bg-muted-foreground/30"
					}`}
				/>
			</div>
			<AuthFlow.Status.Inline />
		</div>
	);
}

function ApiKeyCard() {
	const { state, actions } = useAuthFlowProvider();
	const [apiKey, setApiKey] = useState("");
	const saveRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	// Sync local input state with auth status — clear on remove
	useEffect(() => {
		if (!state.authenticated) {
			setApiKey("");
		}
	}, [state.authenticated]);

	useEffect(() => {
		return () => {
			if (saveRef.current) clearTimeout(saveRef.current);
		};
	}, []);

	const handleChange = (value: string) => {
		setApiKey(value);
		if (saveRef.current) clearTimeout(saveRef.current);
		const trimmed = value.trim();
		if (trimmed) {
			saveRef.current = setTimeout(() => {
				actions.saveApiKey(trimmed);
			}, 600);
		}
	};


	return (
		<div className="rounded-lg bg-muted/40 p-2 space-y-2">
			<div className="flex items-center gap-2">
				<span className="flex-1 text-xs font-medium">{state.provider?.name}</span>
				{state.authenticated && (
					<Button
						size="xs"
						variant="ghost"
						onClick={async () => {
							if (saveRef.current) clearTimeout(saveRef.current);
							setApiKey("");
							await actions.removeApiKey();
						}}
						className="text-muted-foreground"
					>
						<Unlink className="size-3.5" /> Remove
					</Button>
				)}
				<div
					className={`size-1.5 shrink-0 rounded-full ${
						state.authenticated ? "bg-emerald-500" : "bg-muted-foreground/30"
					}`}
				/>
			</div>
			<Input
				size="sm"
				type="password"
				value={apiKey}
				onChange={(e) => handleChange(e.target.value)}
				placeholder="sk-..."
			/>
		</div>
	);
}

function ModelsContent() {
	const auth = useAuthFlowController();
	const oauthProviders = auth.state.providers.filter((p) => p.supportsOAuth);
	const apiKeyProviders = auth.state.providers.filter((p) => !p.supportsOAuth);

	return (
		<div className="flex-1 overflow-y-auto min-h-0">
			<div className="space-y-4 px-4 py-3">
				{oauthProviders.length > 0 && (
					<div className="space-y-2">
						<span className="text-[10px] font-medium text-muted-foreground px-1">
							Subscription
						</span>
						<div className="space-y-2">
							{oauthProviders.map((p) => (
								<AuthFlow.Provider key={p.id} controller={auth} providerId={p.id}>
									<OAuthCard />
								</AuthFlow.Provider>
							))}
						</div>
					</div>
				)}
				{apiKeyProviders.length > 0 && (
					<div className="space-y-2">
						<span className="text-[10px] font-medium text-muted-foreground px-1">
							API Key
						</span>
						<div className="space-y-2">
							{apiKeyProviders.map((p) => (
								<AuthFlow.Provider key={p.id} controller={auth} providerId={p.id}>
									<ApiKeyCard />
								</AuthFlow.Provider>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export function GlobalSettings() {
	return (
		<WindowChrome.Root>
			<WindowChrome.Content>
				<div className="flex flex-1 min-h-0 view-enter">
					<SidebarProvider
						style={{ "--sidebar-width": "14rem" } as React.CSSProperties}
						className="min-h-0 flex-1"
					>
						<Sidebar variant="floating" collapsible="none">
							<SidebarHeader className="electrobun-webkit-app-region-drag pt-4 pl-3">
								<div className="electrobun-webkit-app-region-no-drag pb-2">
									<WindowChrome.Controls />
								</div>
								<SidebarMenu>
									<SidebarMenuItem>
										<SidebarMenuButton size="lg" className="cursor-default electrobun-webkit-app-region-no-drag">
											<Avatar
												name="Plot"
												variant="beam"
												size={32}
												className="rounded-lg"
											/>
											<div className="flex flex-col gap-1 leading-none">
												<span className="font-medium truncate">Plot</span>
												<span className="text-[10px] text-sidebar-foreground/50">
													Settings
												</span>
											</div>
										</SidebarMenuButton>
									</SidebarMenuItem>
								</SidebarMenu>
							</SidebarHeader>
							<SidebarContent>
								<SidebarGroup>
									<SidebarMenu>
										<SidebarMenuItem>
											<SidebarMenuButton size="sm" isActive>
												<Cpu className="size-3.5" />
												Models
											</SidebarMenuButton>
										</SidebarMenuItem>
									</SidebarMenu>
								</SidebarGroup>
							</SidebarContent>
						</Sidebar>
						<SidebarInset className="flex flex-col min-h-0">
							<div className="electrobun-webkit-app-region-drag h-10 shrink-0" />
							<ModelsContent />
						</SidebarInset>
					</SidebarProvider>
				</div>
			</WindowChrome.Content>
		</WindowChrome.Root>
	);
}
