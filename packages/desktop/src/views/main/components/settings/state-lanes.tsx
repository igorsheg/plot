import {
	createContext,
	use,
	useState,
	useCallback,
	useMemo,
	type ReactNode,
} from "react";
import type { TrackerConfig } from "../../../../shared/rpc";
import { Button } from "@plot/ui/components/button";
import { Input } from "@plot/ui/components/input";
import { X } from "lucide-react";

// ── Context ──────────────────────────────────────────

type Phase = "dispatch" | "parked" | "terminal";

const PHASE_KEY: Record<Phase, keyof TrackerConfig> = {
	dispatch: "dispatchStates",
	parked: "parkedStates",
	terminal: "terminalStates",
};

interface StateLanesState {
	tracker: TrackerConfig;
}

interface StateLanesActions {
	addLabel: (phase: Phase, label: string) => void;
	removeLabel: (phase: Phase, label: string) => void;
}

interface StateLanesContextValue {
	state: StateLanesState;
	actions: StateLanesActions;
}

const StateLanesContext = createContext<StateLanesContextValue | null>(null);

function useStateLanes(): StateLanesContextValue {
	const ctx = use(StateLanesContext);
	if (!ctx) throw new Error("StateLanes.* must be used inside StateLanes");
	return ctx;
}

// ── Root ─────────────────────────────────────────────

function Root({
	tracker,
	onTrackerChange,
	children,
}: {
	tracker: TrackerConfig;
	onTrackerChange: (tracker: TrackerConfig) => void;
	children: ReactNode;
}) {
	const addLabel = useCallback(
		(phase: Phase, label: string) => {
			const key = PHASE_KEY[phase];
			const current = (tracker[key] as string[] | undefined) ?? [];
			if (!current.includes(label)) {
				onTrackerChange({ ...tracker, [key]: [...current, label] });
			}
		},
		[tracker, onTrackerChange],
	);

	const removeLabel = useCallback(
		(phase: Phase, label: string) => {
			const key = PHASE_KEY[phase];
			const current = (tracker[key] as string[] | undefined) ?? [];
			onTrackerChange({
				...tracker,
				[key]: current.filter((v) => v !== label),
			});
		},
		[tracker, onTrackerChange],
	);

	const value = useMemo<StateLanesContextValue>(
		() => ({
			state: { tracker },
			actions: { addLabel, removeLabel },
		}),
		[tracker, addLabel, removeLabel],
	);

	return (
		<StateLanesContext value={value}>
			<div className="grid grid-cols-3 gap-2">{children}</div>
		</StateLanesContext>
	);
}

// ── LabelChip ────────────────────────────────────────

function LabelChip({
	phase,
	tag,
	onRemove,
}: {
	phase: Phase;
	tag: string;
	onRemove: (phase: Phase, tag: string) => void;
}) {
	const handleClick = useCallback(
		() => onRemove(phase, tag),
		[onRemove, phase, tag],
	);

	return (
		<div className="group flex items-center justify-between rounded-md bg-background/80 px-2 py-1">
			<span className="text-[10px] text-foreground truncate">{tag}</span>
			<Button
				size="icon-2xs"
				variant="ghost"
				onClick={handleClick}
				className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0"
			>
				<X className="size-2.5" />
			</Button>
		</div>
	);
}

// ── Lane ─────────────────────────────────────────────

function Lane({
	phase,
	label,
	description,
	color,
}: {
	phase: Phase;
	label: string;
	description: string;
	color: string;
}) {
	const { state, actions } = useStateLanes();
	const [input, setInput] = useState("");

	const key = PHASE_KEY[phase];
	const raw = state.tracker[key] as string[] | undefined;
	const labels = useMemo(() => raw ?? [], [raw]);

	const addTag = useCallback(() => {
		const trimmed = input.trim();
		if (trimmed && !labels.includes(trimmed)) {
			actions.addLabel(phase, trimmed);
			setInput("");
		}
	}, [input, labels, actions, phase]);

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value),
		[],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Enter") {
				e.preventDefault();
				addTag();
			}
		},
		[addTag],
	);

	return (
		<div className="flex flex-col rounded-lg bg-muted/40 p-2.5">
			<div className="flex items-center gap-1.5 pb-2">
				<div className={`size-1.5 rounded-full ${color}`} />
				<span className="text-[11px] font-medium">{label}</span>
			</div>
			<p className="text-[10px] text-muted-foreground pb-2.5">{description}</p>
			<div className="flex flex-col gap-1 flex-1">
				{labels.map((tag) => (
					<LabelChip
						key={tag}
						phase={phase}
						tag={tag}
						onRemove={actions.removeLabel}
					/>
				))}
			</div>
			<Input
				size="xs"
				value={input}
				onChange={handleInputChange}
				onKeyDown={handleKeyDown}
				placeholder="+ add..."
				className="mt-1.5"
			/>
		</div>
	);
}

// ── Export ────────────────────────────────────────────

export const StateLanes = {
	Root,
	Lane,
};
