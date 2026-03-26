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

	return (
		<div className="flex flex-col">
			<div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
				<Button variant="ghost" size="sm" onClick={onOpenInEditor}>
					Open in Editor
				</Button>
				<Button size="sm" onClick={handleSave} disabled={!dirty}>
					{dirty ? "Save" : "Saved"}
				</Button>
			</div>

			<Tabs defaultValue="tracker" className="flex-1">
				<TabsList className="mx-4 mt-3">
					<TabsTab value="tracker">Tracker</TabsTab>
					<TabsTab value="agent">Agent</TabsTab>
					<TabsTab value="advanced">Advanced</TabsTab>
				</TabsList>

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
			</Tabs>
		</div>
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
				<select
					value={tracker.kind}
					onChange={(e) =>
						onUpdate((c) => ({
							...c,
							tracker: { ...tracker, kind: e.target.value },
						}))
					}
					className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
				>
					<option value="github">GitHub</option>
					<option value="beads">Beads</option>
				</select>
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
					<select
						value={selectedProvider}
						onChange={(e) => setModel(e.target.value, "")}
						className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
					>
						<option value="">Select provider</option>
						{providers.map((p) => (
							<option key={p.id} value={p.id}>
								{p.id}
							</option>
						))}
					</select>
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
				<select
					value={selectedModel}
					onChange={(e) => setModel(selectedProvider, e.target.value)}
					className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
					disabled={providerModels.length === 0}
				>
					<option value="">Select model</option>
					{providerModels.map((m) => (
						<option key={m.id} value={m.id}>
							{m.name}
						</option>
					))}
				</select>
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
