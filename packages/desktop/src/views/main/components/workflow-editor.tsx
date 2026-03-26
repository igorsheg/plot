import { useState, useCallback } from "react";
import type {
	WorkflowDocument,
	WorkflowFrontmatter,
	ProviderInfo,
	AuthState,
} from "../../../shared/rpc";
import { Button } from "@plot/ui/components/button";
import { Input } from "@plot/ui/components/input";
import { Label } from "@plot/ui/components/label";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@plot/ui/components/tabs";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "@plot/ui/components/select";
import { Badge } from "@plot/ui/components/badge";

type Props = {
	workflow: WorkflowDocument;
	providers: ProviderInfo[];
	authStatus: Array<{ id: string; name: string; authenticated: boolean }>;
	authState: AuthState;
	onSave: (workflow: WorkflowDocument) => void;
	onOpenInEditor: () => void;
	onStartAuth: (providerId: string) => void;
	onSubmitAuthResponse: (value: string) => void;
	projectName: string;
	projectStatus: string;
	agentCount: number;
	saved: boolean;
};

export function WorkflowEditor({
	workflow: initial,
	providers,
	authStatus,
	authState,
	onSave,
	onOpenInEditor,
	onStartAuth,
	onSubmitAuthResponse,
	projectName,
	projectStatus,
	agentCount,
	saved,
}: Props) {
	const [config, setConfig] = useState<WorkflowFrontmatter>(initial.config);
	const [dirty, setDirty] = useState(false);

	const update = useCallback(
		(fn: (c: WorkflowFrontmatter) => WorkflowFrontmatter) => {
			setConfig((prev) => {
				const next = fn(prev);
				setDirty(true);
				return next;
			});
		},
		[],
	);

	const handleSave = useCallback(() => {
		onSave({ config, promptBody: initial.promptBody });
		setDirty(false);
	}, [config, initial.promptBody, onSave]);

	const currentModel = config.agent?.model ?? "";
	const [selectedProvider, selectedModel] = currentModel.includes("/")
		? [currentModel.split("/")[0]!, currentModel.split("/").slice(1).join("/")]
		: [currentModel, ""];

	const providerModels =
		providers.find((p) => p.id === selectedProvider)?.models ?? [];
	const providerAuth = authStatus.find((a) => a.id === selectedProvider);

	const statusLabel: Record<string, string> = {
		idle: "Idle",
		launching: "Launching...",
		connecting: "Connecting...",
		streaming: "Running",
		stopping: "Stopping...",
		stopped: "Stopped",
		failed: "Error",
	};

	const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
		idle: "outline",
		launching: "secondary",
		connecting: "secondary",
		streaming: "default",
		stopping: "secondary",
		stopped: "outline",
		failed: "destructive",
	};

	return (
		<Tabs defaultValue="tracker" className="flex min-h-screen flex-col">
			<div className="electrobun-webkit-app-region-drag titlebar flex shrink-0 items-end justify-between px-4 pb-2">
				<div className="electrobun-webkit-app-region-no-drag ml-[68px] flex items-center gap-3">
					<div className="flex items-center gap-2">
						<span className="text-label font-semibold">{projectName}</span>
						<Badge
							variant={statusVariant[projectStatus] ?? "outline"}
							size="sm"
						>
							{statusLabel[projectStatus] ?? projectStatus}
						</Badge>
						{agentCount > 0 && (
							<span className="text-micro text-muted-foreground">
								{agentCount} agent{agentCount !== 1 ? "s" : ""}
							</span>
						)}
					</div>
					<TabsList>
						<TabsTab value="tracker">Tracker</TabsTab>
						<TabsTab value="agent">Agent</TabsTab>
						<TabsTab value="advanced">Advanced</TabsTab>
					</TabsList>
				</div>
				<div className="electrobun-webkit-app-region-no-drag flex items-center gap-2">
					{saved && (
						<span className="text-micro text-emerald-400">Saved</span>
					)}
					<Button variant="ghost" size="xs" onClick={onOpenInEditor}>
						Open in Editor
					</Button>
					<Button size="xs" onClick={handleSave} disabled={!dirty}>
						Save
					</Button>
				</div>
			</div>

			<div className="flex-1 overflow-auto">
				<TabsPanel value="tracker" className="space-y-4 p-4">
					<TrackerTab config={config} onUpdate={update} />
				</TabsPanel>

				<TabsPanel value="agent" className="space-y-4 p-4">
					<AgentTab
						config={config}
						onUpdate={update}
						providers={providers}
						selectedProvider={selectedProvider}
						selectedModel={selectedModel}
						providerModels={providerModels}
						providerAuth={providerAuth}
						authState={authState}
						onStartAuth={onStartAuth}
						onSubmitAuthResponse={onSubmitAuthResponse}
					/>
				</TabsPanel>

				<TabsPanel value="advanced" className="space-y-4 p-4">
					<AdvancedTab config={config} onUpdate={update} />
				</TabsPanel>
			</div>
		</Tabs>
	);
}

function TrackerTab({
	config,
	onUpdate,
}: {
	config: WorkflowFrontmatter;
	onUpdate: (fn: (c: WorkflowFrontmatter) => WorkflowFrontmatter) => void;
}) {
	const tracker = config.tracker ?? { kind: "github" };

	return (
		<>
			<div className="space-y-1.5">
				<Label className="text-xs">Tracker Kind</Label>
				<Select value={tracker.kind} onValueChange={(val) => {
					if (val === null) return;
					onUpdate((c) => ({
						...c,
						tracker: { ...tracker, kind: val },
					}));
				}
				}>
					<SelectTrigger size="sm">
						<SelectValue />
					</SelectTrigger>
					<SelectPopup>
						<SelectItem value="github">GitHub</SelectItem>
						<SelectItem value="beads">Beads</SelectItem>
					</SelectPopup>
				</Select>
			</div>

			<div className="space-y-1.5">
				<Label className="text-xs">Dispatch States</Label>
				<Input
					value={tracker.dispatchStates?.join(", ") ?? ""}
					onChange={(e) =>
						onUpdate((c) => ({
							...c,
							tracker: {
								...tracker,
								dispatchStates: e.target.value
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean),
							},
						}))
					}
					placeholder="plot:todo, plot:in-progress"
				/>
			</div>

			<div className="space-y-1.5">
				<Label className="text-xs">Parked States</Label>
				<Input
					value={tracker.parkedStates?.join(", ") ?? ""}
					onChange={(e) =>
						onUpdate((c) => ({
							...c,
							tracker: {
								...tracker,
								parkedStates: e.target.value
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean),
							},
						}))
					}
					placeholder="plot:human-review"
				/>
			</div>

			<div className="space-y-1.5">
				<Label className="text-xs">Terminal States</Label>
				<Input
					value={tracker.terminalStates?.join(", ") ?? ""}
					onChange={(e) =>
						onUpdate((c) => ({
							...c,
							tracker: {
								...tracker,
								terminalStates: e.target.value
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean),
							},
						}))
					}
					placeholder="plot:done"
				/>
			</div>
		</>
	);
}

function AgentTab({
	config,
	onUpdate,
	providers,
	selectedProvider,
	selectedModel,
	providerModels,
	providerAuth,
	authState,
	onStartAuth,
	onSubmitAuthResponse,
}: {
	config: WorkflowFrontmatter;
	onUpdate: (fn: (c: WorkflowFrontmatter) => WorkflowFrontmatter) => void;
	providers: ProviderInfo[];
	selectedProvider: string;
	selectedModel: string;
	providerModels: ProviderInfo["models"];
	providerAuth?: { id: string; name: string; authenticated: boolean };
	authState: AuthState;
	onStartAuth: (providerId: string) => void;
	onSubmitAuthResponse: (value: string) => void;
}) {
	const [authInput, setAuthInput] = useState("");

	const setModel = useCallback(
		(provider: string, model: string) => {
			const fullModel = model ? `${provider}/${model}` : provider;
			onUpdate((c) => ({
				...c,
				agent: { ...c.agent, model: fullModel },
			}));
		},
		[onUpdate],
	);

	return (
		<>
			<fieldset className="space-y-3 rounded-lg border border-border/50 p-3">
				<legend className="px-1 text-xs font-medium text-muted-foreground">
					Provider
				</legend>
				<div className="flex items-center gap-2">
					<Select value={selectedProvider} onValueChange={(val) => { if (val !== null) setModel(val, ""); }}>
						<SelectTrigger size="sm" className="flex-1">
							<SelectValue placeholder="Select provider" />
						</SelectTrigger>
						<SelectPopup>
							{providers.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.id}
								</SelectItem>
							))}
						</SelectPopup>
					</Select>
					{providerAuth &&
						(providerAuth.authenticated ? (
							<Badge variant="secondary" className="shrink-0 text-emerald-400">
								Authenticated
							</Badge>
						) : (
							<Button
								variant="outline"
								size="sm"
								className="shrink-0"
								onClick={() => onStartAuth(selectedProvider)}
								disabled={
									authState.phase === "authenticating" ||
									authState.phase === "waitingForCode"
								}
							>
								Login
							</Button>
						))}
				</div>

				{authState.phase === "waitingForCode" && (
					<div className="space-y-2 rounded-md border border-border/50 bg-muted/30 p-2.5">
						<p className="text-xs">{authState.message}</p>
						<div className="flex gap-2">
							<Input
								value={authInput}
								onChange={(e) => setAuthInput(e.target.value)}
								placeholder={authState.placeholder}
								className="flex-1 text-xs"
								onKeyDown={(e) => {
									if (e.key === "Enter" && authInput) {
										onSubmitAuthResponse(authInput);
										setAuthInput("");
									}
								}}
							/>
							<Button
								size="sm"
								onClick={() => {
									onSubmitAuthResponse(authInput);
									setAuthInput("");
								}}
								disabled={!authInput}
							>
								Submit
							</Button>
						</div>
					</div>
				)}

				{authState.phase === "authenticating" && (
					<p className="text-xs text-muted-foreground">Authenticating...</p>
				)}
				{authState.phase === "success" && (
					<p className="text-xs text-emerald-400">Authentication successful</p>
				)}
				{authState.phase === "failed" && (
					<p className="text-xs text-destructive">{authState.error}</p>
				)}
			</fieldset>

			<fieldset className="space-y-3 rounded-lg border border-border/50 p-3">
				<legend className="px-1 text-xs font-medium text-muted-foreground">
					Model
				</legend>
				<Select value={selectedModel} onValueChange={(val) => { if (val !== null) setModel(selectedProvider, val); }} disabled={providerModels.length === 0}>
					<SelectTrigger size="sm">
						<SelectValue placeholder="Select model" />
					</SelectTrigger>
					<SelectPopup>
						{providerModels.map((m) => (
							<SelectItem key={m.id} value={m.id}>
								{m.name}
							</SelectItem>
						))}
					</SelectPopup>
				</Select>
			</fieldset>

			<fieldset className="space-y-3 rounded-lg border border-border/50 p-3">
				<legend className="px-1 text-xs font-medium text-muted-foreground">
					Limits
				</legend>
				<div className="grid grid-cols-2 gap-3">
					<div className="space-y-1.5">
						<Label className="text-xs">Max Concurrent Agents</Label>
						<Input
							type="number"
							value={config.agent?.maxConcurrentAgents ?? ""}
							onChange={(e) =>
								onUpdate((c) => ({
									...c,
									agent: {
										...c.agent,
										maxConcurrentAgents: e.target.value
											? Number(e.target.value)
											: undefined,
									},
								}))
							}
							placeholder="1"
						/>
					</div>
					<div className="space-y-1.5">
						<Label className="text-xs">Max Turns</Label>
						<Input
							type="number"
							value={config.agent?.maxTurns ?? ""}
							onChange={(e) =>
								onUpdate((c) => ({
									...c,
									agent: {
										...c.agent,
										maxTurns: e.target.value
											? Number(e.target.value)
											: undefined,
									},
								}))
							}
							placeholder="50"
						/>
					</div>
				</div>
			</fieldset>
		</>
	);
}

function AdvancedTab({
	config,
	onUpdate,
}: {
	config: WorkflowFrontmatter;
	onUpdate: (fn: (c: WorkflowFrontmatter) => WorkflowFrontmatter) => void;
}) {
	return (
		<div className="space-y-1.5">
			<Label className="text-xs">Workspace Root</Label>
			<Input
				value={config.workspace?.root ?? ""}
				onChange={(e) =>
					onUpdate((c) => ({
						...c,
						workspace: { ...c.workspace, root: e.target.value || undefined },
					}))
				}
				placeholder="./workspaces"
			/>
			<p className="text-[11px] text-muted-foreground">
				Directory where agent workspaces are created (relative to project root)
			</p>
		</div>
	);
}
