import { use, useState, useEffect } from "react";
import { AppContext } from "../../context/app-context";
import { rpc } from "../../context/rpc";
import { useSettings } from "./context";
import { Row, ModelCombobox } from "./helpers";
import { StateLanes } from "./state-lanes";
import { useAuthFlowController } from "../auth-flow";
import {
	NumberField,
	NumberFieldGroup,
	NumberFieldDecrement,
	NumberFieldIncrement,
	NumberFieldInput,
} from "@plot/ui/components/number-field";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectPopup,
	SelectItem,
} from "@plot/ui/components/select";
import { RadioGroup, Radio } from "@plot/ui/components/radio-group";
import { Button } from "@plot/ui/components/button";

// ── Tracker ──────────────────────────────────────────

export function TrackerSection() {
	const { state: { config }, actions: { update } } = useSettings();
	const tracker = config.tracker ?? { kind: "github" };

	return (
		<div className="space-y-4">
			<Row label="Issue source" description="Where Plot finds work items">
				<Select
					value={tracker.kind}
					onValueChange={(val) => {
						if (val !== null)
							update((c) => ({
								...c,
								tracker: { ...tracker, kind: val },
							}));
					}}
				>
					<SelectTrigger size="sm" className="w-[160px]">
						<SelectValue placeholder="Select source" />
					</SelectTrigger>
					<SelectPopup size="xs">
						<SelectItem size="xs" value="github">
							GitHub Issues
						</SelectItem>
						<SelectItem size="xs" value="beads">
							Beads
						</SelectItem>
						{tracker.kind !== "github" && tracker.kind !== "beads" && (
							<SelectItem size="xs" value={tracker.kind}>
								{tracker.kind}
							</SelectItem>
						)}
					</SelectPopup>
				</Select>
			</Row>
			<StateLanes.Root
				tracker={tracker}
				onTrackerChange={(next) => update((c) => ({ ...c, tracker: next }))}
			>
				<StateLanes.Lane
					phase="dispatch"
					label="Active"
					description="starts work"
					color="bg-emerald-500"
				/>
				<StateLanes.Lane
					phase="parked"
					label="Paused"
					description="waits for human"
					color="bg-amber-500"
				/>
				<StateLanes.Lane
					phase="terminal"
					label="Done"
					description="closes the issue"
					color="bg-blue-500"
				/>
			</StateLanes.Root>
		</div>
	);
}

// ── Agent ────────────────────────────────────────────

export function AgentSection() {
	const { state: { config }, actions: { update } } = useSettings();
	const auth = useAuthFlowController();

	const currentModel = config.agent?.model ?? "";
	const onModelChange = (fullModel: string) =>
		update((c) => ({ ...c, agent: { ...c.agent, model: fullModel } }));

	const authenticatedProviders = auth.state.providers.filter(
		(p) => p.authenticated,
	);

	const selectedProvider = currentModel.includes("/")
		? currentModel.split("/")[0]!
		: currentModel;
	const selectedModelId = currentModel.includes("/")
		? currentModel.split("/").slice(1).join("/")
		: "";

	const selectProvider = (value: string) => {
		if (value !== selectedProvider) {
			const provider = authenticatedProviders.find((p) => p.id === value);
			const firstModel = provider?.models[0];
			onModelChange(firstModel ? `${value}/${firstModel.id}` : value);
		}
	};

	if (authenticatedProviders.length === 0) {
		return (
			<p className="text-xs text-muted-foreground">
				No providers connected. Open Settings from the tray menu to add one.
			</p>
		);
	}

	return (
		<RadioGroup value={selectedProvider} onValueChange={selectProvider} className="gap-2">
			{authenticatedProviders.map((p) => {
				const isSelected = selectedProvider === p.id;
				return (
					<div
						key={p.id}
						className={`rounded-lg p-2 transition-all duration-200 ${
							isSelected ? "bg-accent/80" : "bg-muted/40 hover:bg-muted/60"
						}`}
					>
						<label className="flex items-center gap-2 cursor-pointer">
							<Radio size="xs" value={p.id} />
							<span className="flex-1 text-xs font-medium">{p.name}</span>
							<div className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
						</label>
						{isSelected && p.models.length > 0 && (
							<div className="pt-2 pl-5">
								<ModelCombobox
									models={p.models}
									selectedModel={selectedModelId}
									onSelect={(modelId) => onModelChange(`${p.id}/${modelId}`)}
								/>
							</div>
						)}
					</div>
				);
			})}
		</RadioGroup>
	);
}

// ── Agent Limits ─────────────────────────────────────

export function AgentLimitsSection() {
	const { state: { config }, actions: { update } } = useSettings();

	return (
		<div>
			<Row label="Max agents" description="Concurrent agents per project">
				<NumberField
					value={config.agent?.maxConcurrentAgents ?? 1}
					min={1}
					max={10}
					onValueChange={(val) =>
						update((c) => ({
							...c,
							agent: { ...c.agent, maxConcurrentAgents: val ?? 1 },
						}))
					}
					size="sm"
					className="w-auto"
				>
					<NumberFieldGroup className="w-fit">
						<NumberFieldDecrement />
						<NumberFieldInput className="w-10 text-center" />
						<NumberFieldIncrement />
					</NumberFieldGroup>
				</NumberField>
			</Row>
			<Row label="Max turns" description="Maximum turns per agent session">
				<NumberField
					value={config.agent?.maxTurns ?? 50}
					min={1}
					max={500}
					step={10}
					onValueChange={(val) =>
						update((c) => ({
							...c,
							agent: { ...c.agent, maxTurns: val ?? 50 },
						}))
					}
					size="sm"
					className="w-auto"
				>
					<NumberFieldGroup className="w-fit">
						<NumberFieldDecrement />
						<NumberFieldInput className="w-12 text-center" />
						<NumberFieldIncrement />
					</NumberFieldGroup>
				</NumberField>
			</Row>
		</div>
	);
}

// ── Workspace ────────────────────────────────────────

export function WorkspaceSection() {
	const { state: { config }, actions: { update } } = useSettings();
	const { state: appState } = use(AppContext)!;
	const projectPath = appState.project?.path;
	const [displayPath, setDisplayPath] = useState<string | null>(null);

	useEffect(() => {
		const handler = (e: Event) => {
			const { path: chosen } = (e as CustomEvent<{ path: string }>).detail;

			const value =
				projectPath && chosen.startsWith(projectPath + "/")
					? `./${chosen.slice(projectPath.length + 1)}`
					: chosen;

			setDisplayPath(value);
			update((c) => ({
				...c,
				workspace: { ...c.workspace, root: value },
			}));
		};
		window.addEventListener("plot:folder-picked", handler);
		return () => window.removeEventListener("plot:folder-picked", handler);
	}, [projectPath, update]);

	const pickFolder = () => {
		rpc().request.pickProjectFolder({});
	};

	const shown = displayPath ?? config.workspace?.root ?? "./workspaces";

	return (
		<Row label="Workspace folder" description="Where agent branches are checked out">
			<div className="flex items-center gap-2">
				<span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
					{shown}
				</span>
				<Button
					size="xs"
					variant="outline"
					onClick={pickFolder}
				>
					Change
				</Button>
			</div>
		</Row>
	);
}
