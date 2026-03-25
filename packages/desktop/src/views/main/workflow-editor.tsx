import { useState, type CSSProperties } from "react";
import type { WorkflowFrontmatter } from "../../shared/types";

// --- Shared styles ---

const colors = {
	bg: "#1a1a1a",
	surface: "#242424",
	border: "#333",
	text: "#e5e5e5",
	textMuted: "#999",
	accent: "#4a9eff",
	accentHover: "#3a8eef",
	danger: "#ff4a4a",
	chip: "#2a2a2a",
};

const baseInput: CSSProperties = {
	background: colors.surface,
	border: `1px solid ${colors.border}`,
	borderRadius: 6,
	color: colors.text,
	padding: "6px 10px",
	fontSize: 14,
	outline: "none",
	width: "100%",
	boxSizing: "border-box",
};

const labelStyle: CSSProperties = {
	display: "block",
	fontSize: 13,
	color: colors.textMuted,
	marginBottom: 4,
	fontWeight: 500,
};

const sectionStyle: CSSProperties = {
	marginBottom: 20,
	padding: 16,
	background: colors.surface,
	borderRadius: 8,
	border: `1px solid ${colors.border}`,
};

// --- TagInput ---

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
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: values.length ? 6 : 0 }}>
				{values.map((v, i) => (
					<span
						key={v}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 4,
							background: colors.chip,
							border: `1px solid ${colors.border}`,
							borderRadius: 4,
							padding: "2px 8px",
							fontSize: 13,
							color: colors.text,
						}}
					>
						{v}
						<button
							type="button"
							onClick={() => remove(i)}
							style={{
								background: "none",
								border: "none",
								color: colors.danger,
								cursor: "pointer",
								padding: 0,
								fontSize: 14,
								lineHeight: 1,
							}}
						>
							×
						</button>
					</span>
				))}
			</div>
			<input
				style={baseInput}
				value={input}
				onChange={(e) => setInput(e.target.value)}
				onKeyDown={(e) => {
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

// --- CollapsibleSection ---

function CollapsibleSection({
	title,
	children,
	defaultOpen = false,
}: {
	title: string;
	children: React.ReactNode;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div style={sectionStyle}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				style={{
					background: "none",
					border: "none",
					color: colors.text,
					cursor: "pointer",
					padding: 0,
					fontSize: 15,
					fontWeight: 600,
					display: "flex",
					alignItems: "center",
					gap: 6,
					width: "100%",
				}}
			>
				<span style={{ fontSize: 12, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0)" }}>
					▶
				</span>
				{title}
			</button>
			{open && <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>}
		</div>
	);
}

// --- Field wrapper ---

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<label style={labelStyle}>{label}</label>
			{children}
		</div>
	);
}

// --- Predefined options ---

const trackerKinds = ["github", "beads"];
const modelOptions = ["anthropic/claude-sonnet-4-20250514", "anthropic/claude-opus-4-6"];

// --- WorkflowEditor ---

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
		<div
			style={{
				background: colors.bg,
				color: colors.text,
				fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
				height: "100%",
				overflow: "auto",
				padding: 20,
			}}
		>
			{/* TIER 1 — Essential fields */}
			<div style={sectionStyle}>
				<div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Tracker</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
					<Field label="Tracker Kind">
						<select
							style={{ ...baseInput, cursor: "pointer" }}
							value={isCustomTracker ? "__custom__" : tracker?.kind ?? ""}
							onChange={(e) => {
								const v = e.target.value;
								if (v === "__custom__") {
									updateTracker({ kind: customTracker });
								} else {
									setCustomTracker("");
									updateTracker({ kind: v });
								}
							}}
						>
							<option value="">Select...</option>
							{trackerKinds.map((k) => (
								<option key={k} value={k}>
									{k}
								</option>
							))}
							<option value="__custom__">Custom plugin...</option>
						</select>
						{(isCustomTracker || (!tracker?.kind && customTracker)) && (
							<input
								style={{ ...baseInput, marginTop: 6 }}
								value={customTracker || tracker?.kind || ""}
								onChange={(e) => {
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
			<CollapsibleSection title="Agent Settings">
				<Field label="Model">
					<select
						style={{ ...baseInput, cursor: "pointer" }}
						value={isCustomModel ? "__custom__" : agent?.model ?? ""}
						onChange={(e) => {
							const v = e.target.value;
							if (v === "__custom__") {
								updateAgent({ model: customModel });
							} else {
								setCustomModel("");
								updateAgent({ model: v });
							}
						}}
					>
						<option value="">Select...</option>
						{modelOptions.map((m) => (
							<option key={m} value={m}>
								{m}
							</option>
						))}
						<option value="__custom__">Custom model...</option>
					</select>
					{isCustomModel && (
						<input
							style={{ ...baseInput, marginTop: 6 }}
							value={customModel || agent?.model || ""}
							onChange={(e) => {
								setCustomModel(e.target.value);
								updateAgent({ model: e.target.value });
							}}
							placeholder="provider/model-id"
						/>
					)}
				</Field>

				<Field label="Max Concurrent Agents">
					<input
						type="number"
						min={1}
						max={10}
						style={baseInput}
						value={agent?.maxConcurrentAgents ?? ""}
						onChange={(e) => updateAgent({ maxConcurrentAgents: e.target.value ? Number(e.target.value) : undefined })}
					/>
				</Field>

				<Field label="Max Turns">
					<input
						type="number"
						min={1}
						max={200}
						style={baseInput}
						value={agent?.maxTurns ?? ""}
						onChange={(e) => updateAgent({ maxTurns: e.target.value ? Number(e.target.value) : undefined })}
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
					<input
						style={baseInput}
						value={workspace?.root ?? ""}
						onChange={(e) => update({ workspace: { ...workspace, root: e.target.value || undefined } })}
						placeholder="./workspaces"
					/>
				</Field>
			</CollapsibleSection>

			{/* TIER 3 — Advanced YAML */}
			<CollapsibleSection title="Advanced (YAML)">
				<textarea
					readOnly
					style={{
						...baseInput,
						fontFamily: "'SF Mono', 'Fira Code', monospace",
						fontSize: 13,
						minHeight: 200,
						resize: "vertical",
						whiteSpace: "pre",
					}}
					value={JSON.stringify(fm, null, 2)}
				/>
			</CollapsibleSection>

			{/* Markdown placeholder */}
			<div
				style={{
					...sectionStyle,
					color: colors.textMuted,
					textAlign: "center",
					padding: 40,
					fontSize: 14,
					fontStyle: "italic",
				}}
			>
				Markdown editor will go here
			</div>

			{/* Save button */}
			<button
				type="button"
				onClick={onSave}
				style={{
					background: colors.accent,
					color: "#fff",
					border: "none",
					borderRadius: 6,
					padding: "10px 24px",
					fontSize: 14,
					fontWeight: 600,
					cursor: "pointer",
					width: "100%",
				}}
				onMouseOver={(e) => (e.currentTarget.style.background = colors.accentHover)}
				onMouseOut={(e) => (e.currentTarget.style.background = colors.accent)}
			>
				{dirty ? "Save (unsaved changes)" : "Save"}
			</button>
		</div>
	);
}
