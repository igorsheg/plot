import { useState } from "react";
import type { WorkflowFrontmatter } from "../../shared/types";
import { Button } from "@plot/ui/components/button";
import { Input } from "@plot/ui/components/input";
import { Label } from "@plot/ui/components/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@plot/ui/components/select";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@plot/ui/components/collapsible";
import { Badge } from "@plot/ui/components/badge";
import { cn } from "@plot/ui/lib/utils";

function TagInput({
	values,
	onChange,
	placeholder,
}: {
	values: string[];
	onChange: (values: string[]) => void;
	placeholder?: string;
}) {
	const [input, setInput] = useState("");

	const add = () => {
		const v = input.trim();
		if (v && !values.includes(v)) {
			onChange([...values, v]);
		}
		setInput("");
	};

	const remove = (i: number) => {
		onChange(values.filter((_, idx) => idx !== i));
	};

	return (
		<div>
			{values.length > 0 && (
				<div className="mb-1.5 flex flex-wrap gap-1.5">
					{values.map((v, i) => (
						<Badge key={v} variant="outline" size="sm">
							{v}
							<button
								type="button"
								onClick={() => remove(i)}
								className="ml-0.5 cursor-pointer border-none bg-transparent p-0 text-sm leading-none text-destructive"
							>
								×
							</button>
						</Badge>
					))}
				</div>
			)}
			<Input
				value={input}
				onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
				onKeyDown={(e: React.KeyboardEvent) => {
					if (e.key === "Enter") {
						e.preventDefault();
						add();
					}
				}}
				placeholder={placeholder ?? "Type and press Enter"}
			/>
		</div>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-1">
			<Label className="text-xs text-muted-foreground">{label}</Label>
			{children}
		</div>
	);
}

const trackerKinds = ["github", "beads"];
const modelOptions = ["anthropic/claude-sonnet-4-20250514", "anthropic/claude-opus-4-6"];

export type WorkflowEditorProps = {
	frontmatter: WorkflowFrontmatter;
	body: string;
	onChange: (frontmatter: WorkflowFrontmatter, body: string) => void;
	onSave: () => void;
	dirty: boolean;
};

export function WorkflowEditor({ frontmatter, body, onChange, onSave, dirty }: WorkflowEditorProps) {
	const fm = frontmatter;
	const tracker = fm.tracker;
	const agent = fm.agent;
	const workspace = fm.workspace;

	const trackerKind = tracker?.kind ?? "";
	const agentModel = agent?.model ?? "";

	const [customTracker, setCustomTracker] = useState(() =>
		trackerKinds.includes(trackerKind) ? "" : trackerKind,
	);
	const [customModel, setCustomModel] = useState(() =>
		modelOptions.includes(agentModel) ? "" : agentModel,
	);

	const update = (patch: Partial<WorkflowFrontmatter>) => {
		onChange({ ...fm, ...patch }, body);
	};

	const updateTracker = (patch: Partial<NonNullable<WorkflowFrontmatter["tracker"]>>) => {
		update({ tracker: { kind: trackerKind, ...tracker, ...patch } });
	};

	const updateAgent = (patch: Partial<NonNullable<WorkflowFrontmatter["agent"]>>) => {
		update({ agent: { ...agent, ...patch } });
	};

	const isCustomTracker = !trackerKinds.includes(trackerKind);
	const isCustomModel = !modelOptions.includes(agentModel);

	return (
		<div className="h-full overflow-auto p-5">
			{/* TIER 1 — Essential fields */}
			<div className="mb-5 rounded-lg border border-border bg-card p-4">
				<div className="mb-3.5 text-[15px] font-semibold">Tracker</div>
				<div className="flex flex-col gap-3.5">
					<Field label="Tracker Kind">
						<Select
							value={isCustomTracker ? "__custom__" : tracker?.kind ?? ""}
							onValueChange={(v) => {
								if (v == null) return;
								if (v === "__custom__") {
									updateTracker({ kind: customTracker });
								} else {
									setCustomTracker("");
									updateTracker({ kind: v });
								}
							}}
						>
							<SelectTrigger>
								<SelectValue placeholder="Select..." />
							</SelectTrigger>
							<SelectContent>
								{trackerKinds.map((k) => (
									<SelectItem key={k} value={k}>
										{k}
									</SelectItem>
								))}
								<SelectItem value="__custom__">Custom plugin...</SelectItem>
							</SelectContent>
						</Select>
						{(isCustomTracker || (!tracker?.kind && customTracker)) && (
							<Input
								className="mt-1.5"
								value={customTracker || tracker?.kind || ""}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
									setCustomTracker(e.target.value);
									updateTracker({ kind: e.target.value });
								}}
								placeholder="npm package name"
							/>
						)}
					</Field>

					<Field label="Dispatch States">
						<TagInput
							values={tracker?.dispatchStates ?? []}
							onChange={(v) => updateTracker({ dispatchStates: v })}
							placeholder="Add state, press Enter"
						/>
					</Field>

					<Field label="Terminal States">
						<TagInput
							values={tracker?.terminalStates ?? []}
							onChange={(v) => updateTracker({ terminalStates: v })}
							placeholder="Add state, press Enter"
						/>
					</Field>
				</div>
			</div>

			{/* TIER 2 — Agent Settings */}
			<Collapsible className="mb-5 rounded-lg border border-border bg-card p-4">
				<CollapsibleTrigger className="flex w-full items-center gap-1.5 text-[15px] font-semibold text-foreground">
					<span className="text-xs transition-transform duration-150 [[data-panel-open]_&]:rotate-90">▶</span>
					Agent Settings
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="mt-3.5 flex flex-col gap-3.5">
						<Field label="Model">
							<Select
								value={isCustomModel ? "__custom__" : agent?.model ?? ""}
								onValueChange={(v) => {
								if (v == null) return;
									if (v === "__custom__") {
										updateAgent({ model: customModel });
									} else {
										setCustomModel("");
										updateAgent({ model: v });
									}
								}}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select..." />
								</SelectTrigger>
								<SelectContent>
									{modelOptions.map((m) => (
										<SelectItem key={m} value={m}>
											{m}
										</SelectItem>
									))}
									<SelectItem value="__custom__">Custom model...</SelectItem>
								</SelectContent>
							</Select>
							{isCustomModel && (
								<Input
									className="mt-1.5"
									value={customModel || agent?.model || ""}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
										setCustomModel(e.target.value);
										updateAgent({ model: e.target.value });
									}}
									placeholder="provider/model-id"
								/>
							)}
						</Field>

						<Field label="Max Concurrent Agents">
							<Input
								type="number"
								min={1}
								max={10}
								value={agent?.maxConcurrentAgents ?? ""}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
									updateAgent({ maxConcurrentAgents: e.target.value ? Number(e.target.value) : undefined })
								}
							/>
						</Field>

						<Field label="Max Turns">
							<Input
								type="number"
								min={1}
								max={200}
								value={agent?.maxTurns ?? ""}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
									updateAgent({ maxTurns: e.target.value ? Number(e.target.value) : undefined })
								}
							/>
						</Field>

						<Field label="Parked States">
							<TagInput
								values={tracker?.parkedStates ?? []}
								onChange={(v) => updateTracker({ parkedStates: v })}
								placeholder="Add state, press Enter"
							/>
						</Field>

						<Field label="Workspace Root">
							<Input
								value={workspace?.root ?? ""}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
									update({ workspace: { ...workspace, root: e.target.value || undefined } })
								}
								placeholder="./workspaces"
							/>
						</Field>
					</div>
				</CollapsibleContent>
			</Collapsible>

			{/* TIER 3 — Advanced YAML */}
			<Collapsible className="mb-5 rounded-lg border border-border bg-card p-4">
				<CollapsibleTrigger className="flex w-full items-center gap-1.5 text-[15px] font-semibold text-foreground">
					<span className="text-xs transition-transform duration-150 [[data-panel-open]_&]:rotate-90">▶</span>
					Advanced (YAML)
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="mt-3.5">
						<textarea
							readOnly
							className="min-h-[200px] w-full resize-y whitespace-pre rounded-lg border border-border bg-background p-2.5 font-mono text-[13px] text-foreground outline-none"
							value={JSON.stringify(fm, null, 2)}
						/>
					</div>
				</CollapsibleContent>
			</Collapsible>

			{/* Markdown placeholder */}
			<div className="mb-5 rounded-lg border border-border bg-card p-10 text-center text-sm italic text-muted-foreground">
				Markdown editor will go here
			</div>

			{/* Save button */}
			<Button className="w-full" onClick={onSave}>
				{dirty ? "Save (unsaved changes)" : "Save"}
			</Button>
		</div>
	);
}
