import {
	createContext,
	use,
	useState,
	useCallback,
	useMemo,
	type ReactNode,
} from "react";
import type { WorkflowConfig, TrackerConfig } from "../../../../shared/rpc";
import { AppContext } from "../../context/app-context";
import { rpc } from "../../context/rpc";
import { Button } from "@plot/ui/components/button";
import { Input } from "@plot/ui/components/input";
import { RadioGroup, Radio } from "@plot/ui/components/radio-group";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@plot/ui/components/tabs";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectPopup,
	SelectItem,
} from "@plot/ui/components/select";
import { useAuthFlowController, AuthFlow } from "../auth-flow";

// ── Context ──────────────────────────────────────────

interface SetupState {
	tracker: TrackerConfig;
	model: string;
}

interface SetupActions {
	setTracker: (tracker: TrackerConfig) => void;
	setModel: (model: string) => void;
	finish: () => void;
}

interface SetupContextValue {
	state: SetupState;
	actions: SetupActions;
}

const SetupContext = createContext<SetupContextValue | null>(null);

function useSetup() {
	const ctx = use(SetupContext);
	if (!ctx) throw new Error("Setup.* must be used inside Setup component");
	return ctx;
}

// ── Tracker presets ──────────────────────────────────

const TRACKER_PRESETS: Record<string, TrackerConfig> = {
	github: {
		kind: "github",
		dispatchStates: ["plot:todo", "plot:in-progress", "plot:rework", "plot:merging"],
		parkedStates: ["plot:human-review"],
		terminalStates: ["plot:done"],
	},
	beads: {
		kind: "beads",
		dispatchStates: ["ready"],
		terminalStates: ["closed"],
	},
};

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-20250514";

// ── Workflow defaults ─────────────────────────────────
//
// Mirrors packages/plot/examples/WORKFLOW.github.md (minus model_by_state).
// The git worktree hook does not assume any package manager — users add
// project-specific install steps (bun install, cargo build, etc.) by hand.

const DEFAULT_POLLING_INTERVAL_MS = 15_000;
const DEFAULT_WORKSPACE_ROOT = "./workspaces";
const DEFAULT_HOOK_AFTER_CREATE =
	'WS=$PWD && cd ../.. && rmdir "$WS" && git worktree add "$WS" HEAD --detach';
const DEFAULT_HOOK_BEFORE_REMOVE =
	'WS=$PWD && cd ../.. && git worktree remove "$WS" --force || true';
const DEFAULT_HOOK_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CONCURRENT_AGENTS = 1;
const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MAX_RETRY_BACKOFF_MS = 60_000;
const DEFAULT_TURN_TIMEOUT_MS = 1_800_000;
const DEFAULT_STALL_TIMEOUT_MS = 300_000;

// ── Provider ─────────────────────────────────────────

function SetupProvider({ children }: { children: ReactNode }) {
	const { state: appState, actions: appActions } = use(AppContext)!;
	const project = appState.project;

	const [tracker, setTracker] = useState<TrackerConfig>(
		TRACKER_PRESETS.github!,
	);
	const [model, setModel] = useState(DEFAULT_MODEL);

	const finish = useCallback(async () => {
		if (!project) return;
		const config: WorkflowConfig = {
			tracker,
			polling: { intervalMs: DEFAULT_POLLING_INTERVAL_MS },
			workspace: { root: DEFAULT_WORKSPACE_ROOT },
			hooks: {
				afterCreate: DEFAULT_HOOK_AFTER_CREATE,
				beforeRemove: DEFAULT_HOOK_BEFORE_REMOVE,
				timeoutMs: DEFAULT_HOOK_TIMEOUT_MS,
			},
			agent: {
				model,
				maxConcurrentAgents: DEFAULT_MAX_CONCURRENT_AGENTS,
				maxTurns: DEFAULT_MAX_TURNS,
				maxRetryBackoffMs: DEFAULT_MAX_RETRY_BACKOFF_MS,
				turnTimeoutMs: DEFAULT_TURN_TIMEOUT_MS,
				stallTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
			},
		};
		await rpc().request.createWorkflow({ projectPath: project.path, config });
		appActions.refreshProject();
	}, [project, tracker, model, appActions]);

	const value = useMemo<SetupContextValue>(
		() => ({
			state: { tracker, model },
			actions: { setTracker, setModel, finish },
		}),
		[tracker, model, finish],
	);

	return <SetupContext value={value}>{children}</SetupContext>;
}

// ── Tracker Section ──────────────────────────────────

type TrackerKind = "github" | "beads" | "custom";

function TrackerSection() {
	const { state, actions } = useSetup();
	const [customInput, setCustomInput] = useState("");

	const trackerKind: TrackerKind =
		state.tracker.kind === "github"
			? "github"
			: state.tracker.kind === "beads"
				? "beads"
				: "custom";

	const handleTrackerChange = useCallback(
		(value: string) => {
			const kind = value as TrackerKind;
			if (kind === "github" || kind === "beads") {
				actions.setTracker(TRACKER_PRESETS[kind]!);
				setCustomInput("");
			} else {
				actions.setTracker({ kind: customInput || "npm:" });
				if (!customInput) setCustomInput("npm:");
			}
		},
		[actions, customInput],
	);

	const handleCustomInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setCustomInput(e.target.value);
			actions.setTracker({ kind: e.target.value });
		},
		[actions],
	);

	return (
		<section className="space-y-2">
			<h3 className="px-1 pb-2 text-[10px] font-medium text-muted-foreground">
				Tracker
			</h3>
			<RadioGroup
				value={trackerKind}
				onValueChange={handleTrackerChange}
				className="space-y-1"
			>
				<label className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors hover:bg-muted/50 has-data-checked:bg-accent/50">
					<Radio size="xs" value="github" />
					<span className="text-sm">GitHub Issues</span>
				</label>
				<label className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors hover:bg-muted/50 has-data-checked:bg-accent/50">
					<Radio size="xs" value="beads" />
					<span className="text-sm">Beads</span>
				</label>
				<label className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors hover:bg-muted/50 has-data-checked:bg-accent/50">
					<Radio size="xs" value="custom" />
					<span className="text-sm">Custom package</span>
				</label>
			</RadioGroup>
			{trackerKind === "custom" && (
				<Input
					size="sm"
					value={customInput}
					onChange={handleCustomInputChange}
					placeholder="npm:@org/my-tracker"
					className="mt-1.5"
					autoFocus
				/>
			)}
		</section>
	);
}

// ── Provider Section ─────────────────────────────────

type AuthPath = "subscription" | "api_key";

function ProviderSelectButton({
	providerId,
	name,
	isSelected,
	onSelect,
}: {
	providerId: string;
	name: string;
	isSelected: boolean;
	onSelect: (id: string) => void;
}) {
	const handleClick = useCallback(
		() => onSelect(providerId),
		[onSelect, providerId],
	);

	return (
		<Button
			variant="ghost"
			size="xs"
			onClick={handleClick}
			className={`w-full justify-between ${isSelected ? "bg-accent/50" : ""}`}
		>
			<span>{name}</span>
			<AuthFlow.Badge />
		</Button>
	);
}

function ProviderSection() {
	const { state, actions } = useSetup();
	const auth = useAuthFlowController();
	const [authPath, setAuthPath] = useState<AuthPath>(() => {
		const current = state.model.includes("/") ? state.model.split("/")[0]! : "";
		const currentProvider = auth.state.providers.find((p) => p.id === current);
		if (currentProvider && !currentProvider.supportsOAuth) return "api_key";
		return "subscription";
	});

	const subscriptionProviders = auth.state.providers.filter(
		(p) => p.supportsOAuth,
	);
	const apiKeyProviders = auth.state.providers.filter((p) => !p.supportsOAuth);

	const selectedProvider = state.model.includes("/")
		? state.model.split("/")[0]!
		: "";

	const selectProvider = useCallback(
		(providerId: string) => {
			const provider = auth.state.providers.find((p) => p.id === providerId);
			const firstModel = provider?.models[0];
			actions.setModel(
				firstModel ? `${providerId}/${firstModel.id}` : providerId,
			);
		},
		[auth.state.providers, actions],
	);

	const handleTabChange = useCallback(
		(value: string | number) => {
			const next = value as AuthPath;
			setAuthPath(next);
			const providers =
				next === "subscription" ? subscriptionProviders : apiKeyProviders;
			const first = providers[0];
			if (first) selectProvider(first.id);
		},
		[subscriptionProviders, apiKeyProviders, selectProvider],
	);

	return (
		<section className="space-y-2">
			<h3 className="px-1 pb-2 text-[10px] font-medium text-muted-foreground">
				Provider
			</h3>
			<Tabs value={authPath} onValueChange={handleTabChange}>
				<TabsList className="w-full">
					<TabsTab value="subscription" size="sm">
						Subscription
					</TabsTab>
					<TabsTab value="api_key" size="sm">
						API Key
					</TabsTab>
				</TabsList>

				<TabsPanel value="subscription" className="pt-3">
					<div className="space-y-1">
						{subscriptionProviders.map((p) => (
							<AuthFlow.Provider key={p.id} controller={auth} providerId={p.id}>
								<ProviderSelectButton
									providerId={p.id}
									name={p.name}
									isSelected={selectedProvider === p.id}
									onSelect={selectProvider}
								/>
							</AuthFlow.Provider>
						))}
					</div>
					{selectedProvider &&
						subscriptionProviders.some((p) => p.id === selectedProvider) && (
							<AuthFlow.Provider
								controller={auth}
								providerId={selectedProvider}
							>
								<div className="mt-2 space-y-2">
									<AuthFlow.ConnectButton
										variant="outline"
										size="sm"
										className="w-full"
									>
										Connect{" "}
										{subscriptionProviders.find(
											(p) => p.id === selectedProvider,
										)?.name ?? selectedProvider}
									</AuthFlow.ConnectButton>
									<AuthFlow.Status.Inline />
								</div>
							</AuthFlow.Provider>
						)}
				</TabsPanel>

				<TabsPanel value="api_key" className="pt-3">
					<div className="space-y-3">
						<div className="space-y-1">
							{apiKeyProviders.map((p) => (
								<AuthFlow.Provider
									key={p.id}
									controller={auth}
									providerId={p.id}
								>
									<ProviderSelectButton
										providerId={p.id}
										name={p.name}
										isSelected={selectedProvider === p.id}
										onSelect={selectProvider}
									/>
								</AuthFlow.Provider>
							))}
						</div>
						{selectedProvider &&
							apiKeyProviders.some((p) => p.id === selectedProvider) && (
								<AuthFlow.Provider
									controller={auth}
									providerId={selectedProvider}
								>
									<AuthFlow.ApiKeyInput />
								</AuthFlow.Provider>
							)}
					</div>
				</TabsPanel>
			</Tabs>
		</section>
	);
}

// ── Model Section ────────────────────────────────────

function ModelSection() {
	const { state, actions } = useSetup();
	const auth = useAuthFlowController();

	const selectedProvider = state.model.includes("/")
		? state.model.split("/")[0]!
		: "";
	const providerModels =
		auth.state.providers.find((p) => p.id === selectedProvider)?.models ?? [];
	const selectedModelId = state.model.includes("/")
		? state.model.split("/").slice(1).join("/")
		: "";

	const handleModelChange = useCallback(
		(v: string | null) => {
			if (v) {
				actions.setModel(selectedProvider ? `${selectedProvider}/${v}` : v);
			}
		},
		[actions, selectedProvider],
	);

	if (!selectedProvider || providerModels.length === 0) return null;

	return (
		<section className="space-y-2">
			<h3 className="px-1 pb-2 text-[10px] font-medium text-muted-foreground">
				Model
			</h3>
			<Select value={selectedModelId} onValueChange={handleModelChange}>
				<SelectTrigger size="sm" className="w-[140px]">
					<SelectValue placeholder="Select model" />
				</SelectTrigger>
				<SelectPopup size="xs">
					{providerModels.map((m) => (
						<SelectItem size="xs" key={m.id} value={m.id}>
							{m.name}
						</SelectItem>
					))}
				</SelectPopup>
			</Select>
		</section>
	);
}

// ── Create Button ────────────────────────────────────

function CreateButton() {
	const { state, actions } = useSetup();
	const canFinish = !!state.tracker.kind && !!state.model;

	return (
		<Button
			size="sm"
			onClick={actions.finish}
			disabled={!canFinish}
			className="w-full active:scale-[0.98]"
		>
			Create Workflow
		</Button>
	);
}

// ── Export ────────────────────────────────────────────

export function Setup() {
	return (
		<SetupProvider>
			<SetupContent />
		</SetupProvider>
	);
}

function SetupContent() {
	return (
		<div className="flex flex-1 flex-col min-h-0">
			<div className="flex-1 overflow-y-auto">
				<div className="space-y-5 px-4 py-3">
					<TrackerSection />
					<ProviderSection />
					<ModelSection />
				</div>
			</div>
			<div className="border-t border-border/30 px-4 py-2.5">
				<CreateButton />
			</div>
		</div>
	);
}
